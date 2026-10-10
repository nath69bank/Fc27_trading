"""Watchlist: add_to_watchlist() and friends."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..engine import ratio_bp
from ..models import MarketPrice, User, WatchlistItem
from .common import ServiceError, engine_for, get_settings_row, iso, not_found
from .market_data import card_view, get_or_create_card, price_view, stats_for
from .scanner import evaluate_item, opportunity_view

SORT_KEYS = {"name", "price", "roi", "profit", "added"}


def _validate_targets(target_buy, target_sell) -> None:
    for label, v in (("Target buy", target_buy), ("Target sell", target_sell)):
        if not isinstance(v, int) or isinstance(v, bool) or v <= 0:
            raise ServiceError(422, "invalid_price", f"{label} must be a positive whole number of coins.")
    if target_sell <= target_buy:
        raise ServiceError(422, "invalid_targets", "Target sell must be higher than target buy.")


def get_item(db: Session, user: User, item_id: str) -> WatchlistItem:
    item = db.get(WatchlistItem, item_id)
    if item is None or item.user_id != user.id:
        raise not_found("Watchlist item")
    return item


def add_to_watchlist(
    db: Session,
    user: User,
    *,
    player_name: str,
    target_buy: int,
    target_sell: int,
    version: str | None = None,
    rating: int | None = None,
    position: str | None = None,
    image_url: str | None = None,
    notes: str = "",
    current_price: int | None = None,
    is_demo: bool = False,
) -> WatchlistItem:
    _validate_targets(target_buy, target_sell)
    card = get_or_create_card(
        db, user, player_name, version=version, rating=rating, position=position, image_url=image_url, is_demo=is_demo
    )
    if db.scalar(select(WatchlistItem).where(WatchlistItem.user_id == user.id, WatchlistItem.card_id == card.id)):
        raise ServiceError(409, "already_watching", f"{card.player_name} is already on your watchlist.")
    item = WatchlistItem(
        user_id=user.id, card_id=card.id, target_buy=target_buy, target_sell=target_sell,
        notes=(notes or "")[:1000], is_demo=is_demo,
    )
    db.add(item)
    if current_price is not None:
        from .market_data import record_price

        record_price(db, user, card, current_price, source="manual")
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ServiceError(409, "already_watching", "That card is already on your watchlist.") from exc
    return item


def update_item(db: Session, user: User, item_id: str, data: dict) -> dict:
    item = get_item(db, user, item_id)
    buy = data.get("target_buy", item.target_buy)
    sell = data.get("target_sell", item.target_sell)
    _validate_targets(buy, sell)
    item.target_buy, item.target_sell = buy, sell
    if data.get("favourite") is not None:
        item.favourite = bool(data["favourite"])
    if data.get("notes") is not None:
        item.notes = str(data["notes"])[:1000]
    card = item.card
    if data.get("image_url") is not None:
        card.image_url = data["image_url"] or None
    if data.get("position") is not None:
        card.position = data["position"] or None
    db.commit()
    return item_view(db, user, item)


def remove_item(db: Session, user: User, item_id: str) -> None:
    item = get_item(db, user, item_id)
    db.delete(item)
    db.commit()


def item_view(db: Session, user: User, item: WatchlistItem) -> dict:
    settings = get_settings_row(db, user)
    engine = engine_for(settings, with_limits=False)
    opp, stats = evaluate_item(db, user, item)
    net = engine.net_after_tax(item.target_sell)
    planned_profit = net - item.target_buy
    price = stats.latest_price
    if price is None:
        alert = "no_data"
    elif stats.is_stale:
        alert = "stale"
    elif price >= item.target_sell:
        alert = "at_target_sell"
    elif price <= item.target_buy:
        alert = "below_target_buy"
    else:
        alert = "none"
    return {
        "id": item.id,
        "card": card_view(item.card),
        "target_buy": item.target_buy,
        "target_sell": item.target_sell,
        "favourite": item.favourite,
        "notes": item.notes,
        "is_demo": item.is_demo,
        "latest_price": price,
        "latest_source": stats.latest_source,
        "last_price_update": iso(stats.latest_at),
        "is_stale": stats.is_stale,
        "historical_low": stats.historical_low,
        "historical_high": stats.historical_high,
        "net_at_target_sell": net,
        "estimated_profit": planned_profit,
        "estimated_roi_pct": ratio_bp(planned_profit, item.target_buy) / 100,
        "profit_at_current_price": (net - price) if price else None,
        "alert_status": alert,
        "signal": opp.signal,
        "signal_explanation": opp.explanation,
        "created_at": iso(item.created_at),
        "updated_at": iso(item.updated_at),
    }


def list_items(
    db: Session, user: User, *, q: str | None = None, favourites: bool = False, sort: str = "added", desc: bool = True
) -> list[dict]:
    rows = db.scalars(select(WatchlistItem).where(WatchlistItem.user_id == user.id)).all()
    views = [item_view(db, user, r) for r in rows]
    if q:
        needle = q.lower()
        views = [
            v for v in views
            if needle in v["card"]["player_name"].lower() or needle in (v["card"]["version"] or "").lower()
        ]
    if favourites:
        views = [v for v in views if v["favourite"]]
    if sort not in SORT_KEYS:
        sort = "added"
    keyfn = {
        "name": lambda v: v["card"]["player_name"].lower(),
        "price": lambda v: v["latest_price"] or 0,
        "roi": lambda v: v["estimated_roi_pct"],
        "profit": lambda v: v["estimated_profit"],
        "added": lambda v: v["created_at"] or "",
    }[sort]
    views.sort(key=keyfn, reverse=desc)
    return views


def item_detail(db: Session, user: User, item_id: str) -> dict:
    item = get_item(db, user, item_id)
    view = item_view(db, user, item)
    opp, stats = evaluate_item(db, user, item)
    history = db.scalars(
        select(MarketPrice).where(MarketPrice.card_id == item.card_id).order_by(MarketPrice.observed_at.asc()).limit(1000)
    ).all()
    view["opportunity"] = opportunity_view(opp, card=item.card, item=item)
    view["price_stats"] = stats.to_dict()
    view["price_history"] = [price_view(p) for p in history]
    return view

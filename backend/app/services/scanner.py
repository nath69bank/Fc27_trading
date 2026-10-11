"""Market opportunity scanner: runs FC27MarketEngine.evaluate_opportunity() against stored data."""

from __future__ import annotations

from dataclasses import replace

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import utcnow
from ..engine import Opportunity
from ..models import AccountBalance, Card, OpportunityEvaluation, Transfer, User, WatchlistItem
from .common import ServiceError, engine_for, get_settings_row, iso
from .market_data import PriceStats, card_view, stats_for

OPEN_STATUSES = ("active", "target_reached", "listed")


def expected_sell_for(strategy: str, target_sell: int, stats: PriceStats) -> int:
    """Expected resale price under the user's default selling strategy."""
    if strategy == "historical_high" and stats.historical_high:
        return stats.historical_high
    if strategy == "quick_flip" and stats.historical_low and stats.historical_high:
        return min(target_sell, (stats.historical_low + stats.historical_high) // 2)
    return target_sell


def position_cost(db: Session, user: User, card_id: str) -> int:
    return int(
        db.scalar(
            select(func.coalesce(func.sum(Transfer.quantity_remaining * Transfer.purchase_price), 0)).where(
                Transfer.user_id == user.id, Transfer.card_id == card_id, Transfer.status.in_(OPEN_STATUSES)
            )
        )
    )


def evaluate_item(db: Session, user: User, item: WatchlistItem, *, quantity: int = 1) -> tuple[Opportunity, PriceStats]:
    settings = get_settings_row(db, user)
    stats = stats_for(db, user, item.card)
    balance = db.get(AccountBalance, user.id)
    opp = engine_for(settings).evaluate_opportunity(
        item.card.player_name,
        stats.latest_price,
        stats.historical_low,
        stats.historical_high,
        price_history=stats.history,
        expected_sell_price=expected_sell_for(settings.default_sell_strategy, item.target_sell, stats),
        observed_at=stats.latest_at,
        data_source=stats.latest_source,
        quantity=quantity,
        existing_position_cost=position_cost(db, user, item.card_id),
        current_exposure=balance.invested_coins,
        trend_24h_bp=stats.trend_24h_bp,
    )
    return opp, stats


def opportunity_view(opp: Opportunity, *, card: Card | None = None, item: WatchlistItem | None = None) -> dict:
    d = opp.to_dict()
    d["card"] = card_view(card) if card else None
    d["watchlist_id"] = item.id if item else None
    d["target_buy"] = item.target_buy if item else None
    d["target_sell"] = item.target_sell if item else None
    d["is_simulated"] = opp.data_source in ("sample", "simulated") if opp.data_source else None
    return d


def record_evaluation(db: Session, user: User, opp: Opportunity, card: Card | None) -> OpportunityEvaluation:
    row = OpportunityEvaluation(
        user_id=user.id,
        card_id=card.id if card else None,
        player_name=opp.player_name,
        signal=opp.signal,
        current_price=opp.current_price,
        estimated_profit=opp.estimated_profit,
        roi_bp=opp.roi_bp,
        data_source=opp.data_source,
        details=opp.to_dict(),
    )
    db.add(row)
    return row


def evaluation_view(e: OpportunityEvaluation) -> dict:
    return {
        "id": e.id,
        "card_id": e.card_id,
        "player_name": e.player_name,
        "signal": e.signal,
        "current_price": e.current_price,
        "estimated_profit": e.estimated_profit,
        "roi_pct": e.roi_bp / 100 if e.roi_bp is not None else None,
        "data_source": e.data_source,
        "explanation": (e.details or {}).get("explanation"),
        "created_at": iso(e.created_at),
    }


def evaluate_watchlist_item(db: Session, user: User, item_id: str, *, quantity: int = 1) -> dict:
    item = db.get(WatchlistItem, item_id)
    if item is None or item.user_id != user.id:
        raise ServiceError(404, "not_found", "Watchlist item not found.")
    opp, _ = evaluate_item(db, user, item, quantity=quantity)
    record_evaluation(db, user, opp, item.card)
    db.commit()
    return opportunity_view(opp, card=item.card, item=item)


def scan_watchlist(db: Session, user: User, *, record: bool = True) -> list[dict]:
    items = db.scalars(select(WatchlistItem).where(WatchlistItem.user_id == user.id)).all()
    results = []
    for item in items:
        opp, _ = evaluate_item(db, user, item)
        if record:
            record_evaluation(db, user, opp, item.card)
        results.append(opportunity_view(opp, card=item.card, item=item))
    if record:
        db.commit()
    order = {"BUY": 0, "SELL": 1, "RISK": 2, "HOLD": 3, "WATCH": 4}
    results.sort(key=lambda r: (order.get(r["signal"], 9), -(r["roi_pct"] or -1e9)))
    return results


def evaluate_manual(db: Session, user: User, data: dict) -> dict:
    """Evaluate prices typed straight into the scanner, with optional per-run thresholds."""
    settings = get_settings_row(db, user)
    engine = engine_for(settings)
    overrides = {}
    if data.get("max_buy_threshold_pct") is not None:
        pct = float(data["max_buy_threshold_pct"])
        if not 50 <= pct <= 200:
            raise ServiceError(422, "invalid_setting", "Entry threshold must be between 50% and 200%.")
        overrides["entry_threshold_bp"] = round(pct * 100)
    if data.get("min_profit") is not None:
        if int(data["min_profit"]) < 0:
            raise ServiceError(422, "invalid_setting", "Minimum profit cannot be negative.")
        overrides["min_profit"] = int(data["min_profit"])
    if data.get("min_roi_pct") is not None:
        if float(data["min_roi_pct"]) < 0:
            raise ServiceError(422, "invalid_setting", "Minimum ROI cannot be negative.")
        overrides["min_roi_bp"] = round(float(data["min_roi_pct"]) * 100)
    if overrides:
        engine.config = replace(engine.config, **overrides)

    history = data.get("price_history") or None
    if history is not None and any((not isinstance(p, int)) or p <= 0 for p in history):
        raise ServiceError(422, "invalid_history", "Price history must be positive whole numbers.")
    name = (data.get("player_name") or "").strip()
    if not name:
        raise ServiceError(422, "invalid_name", "Player name is required.")
    balance = db.get(AccountBalance, user.id)
    opp = engine.evaluate_opportunity(
        name,
        data.get("current_price"),
        data.get("historical_low"),
        data.get("historical_high"),
        price_history=history,
        expected_sell_price=data.get("expected_sell_price"),
        observed_at=utcnow(),
        data_source="manual",
        quantity=int(data.get("quantity") or 1),
        current_exposure=balance.invested_coins,
    )
    record_evaluation(db, user, opp, None)
    db.commit()
    return opportunity_view(opp)


def recent_signals(db: Session, user: User, *, limit: int = 20, signal: str | None = None) -> list[dict]:
    q = select(OpportunityEvaluation).where(OpportunityEvaluation.user_id == user.id)
    if signal:
        q = q.where(OpportunityEvaluation.signal == signal.upper())
    rows = db.scalars(q.order_by(OpportunityEvaluation.created_at.desc()).limit(limit)).all()
    return [evaluation_view(e) for e in rows]

"""In-app alerts. Rules are evaluated on demand (dashboard load, price changes, scans) and
each alert is de-duplicated so the same condition does not fire repeatedly.

Only in-app notifications are provided; no push, email or messaging service is configured."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import utcnow
from ..models import AccountBalance, Alert, Transfer, User, WatchlistItem
from .accounts import ALERT_TYPES, DEFAULT_ALERT_PREFS
from .common import get_settings_row, iso
from .market_data import data_status
from .scanner import OPEN_STATUSES, evaluate_item
from .trading import current_estimate


def _add(db: Session, user: User, *, type: str, severity: str, title: str, message: str, key: str, ref: str | None = None) -> bool:
    if db.scalar(select(Alert.id).where(Alert.user_id == user.id, Alert.dedupe_key == key)):
        return False
    try:
        with db.begin_nested():
            db.add(Alert(user_id=user.id, type=type, severity=severity, title=title, message=message, dedupe_key=key, reference_id=ref))
    except IntegrityError:
        return False
    return True


def refresh_alerts(db: Session, user: User, *, now: datetime | None = None) -> int:
    now = now or utcnow()
    day = now.strftime("%Y-%m-%d")
    settings = get_settings_row(db, user)
    prefs = {**DEFAULT_ALERT_PREFS, **(settings.alert_prefs or {})}
    created = 0

    for item in db.scalars(select(WatchlistItem).where(WatchlistItem.user_id == user.id)).all():
        opp, stats = evaluate_item(db, user, item)
        name = item.card.player_name
        if stats.latest_price is None or stats.is_stale:
            continue
        price = stats.latest_price
        tag = " (simulated data)" if stats.latest_source in ("sample", "simulated") else ""
        if prefs["below_target_buy"] and price <= item.target_buy:
            created += _add(
                db, user, type="below_target_buy", severity="success", ref=item.id,
                title=f"{name} at or below target buy",
                message=f"Latest price {price:,} is at or below your target buy of {item.target_buy:,}{tag}.",
                key=f"below_buy:{item.id}:{day}",
            )
        if prefs["target_sell_reached"] and price >= item.target_sell:
            created += _add(
                db, user, type="target_sell_reached", severity="info", ref=item.id,
                title=f"{name} reached target sell",
                message=f"Latest price {price:,} has reached your target sell of {item.target_sell:,}{tag}.",
                key=f"wl_sell:{item.id}:{day}",
            )
        if prefs["profit_threshold"] and opp.signal == "BUY" and opp.estimated_profit is not None:
            created += _add(
                db, user, type="profit_threshold", severity="success", ref=item.id,
                title=f"BUY signal: {name}",
                message=(
                    f"Estimated {opp.estimated_profit:,} coin profit after tax at {price:,}, above your "
                    f"{settings.min_profit:,} threshold{tag}. Estimates are not guaranteed."
                ),
                key=f"profit:{item.id}:{day}",
            )

    limit_h = settings.holding_limit_hours
    for t in db.scalars(select(Transfer).where(Transfer.user_id == user.id, Transfer.status.in_(OPEN_STATUSES))).all():
        held = (now - t.purchased_at).total_seconds() / 3600
        if prefs["holding_limit"] and held >= limit_h * 0.8:
            over = held >= limit_h
            created += _add(
                db, user, type="holding_limit", severity="danger" if over else "warning", ref=t.id,
                title=f"{t.player_name} {'over' if over else 'near'} holding limit",
                message=f"Held for {held:.0f}h of your {limit_h}h limit ({t.quantity_remaining} card(s)).",
                key=f"hold:{t.id}:{'over' if over else 'near'}",
            )
        price, _ = current_estimate(db, user, t)
        if prefs["target_sell_reached"] and price >= t.target_sell_price:
            created += _add(
                db, user, type="target_sell_reached", severity="success", ref=t.id,
                title=f"Transfer target reached: {t.player_name}",
                message=f"Estimated price {price:,} has reached your target sell of {t.target_sell_price:,}. Consider listing.",
                key=f"tr_sell:{t.id}:{day}",
            )

    status = data_status(db, user)
    if prefs["stale_data"] and status["mode"] != "none" and status["is_stale"]:
        created += _add(
            db, user, type="stale_data", severity="warning",
            title="Market data is stale",
            message=f"Latest price is {status['age_hours']:.0f}h old (limit {settings.stale_after_hours}h). Signals will show WATCH until refreshed.",
            key=f"stale:{day}",
        )

    balance = db.get(AccountBalance, user.id)
    threshold = settings.max_portfolio_exposure * settings.exposure_warning_bp // 10_000
    if prefs["exposure_limit"] and balance.invested_coins >= threshold and balance.invested_coins > 0:
        created += _add(
            db, user, type="exposure_limit", severity="warning",
            title="Approaching portfolio exposure limit",
            message=f"{balance.invested_coins:,} coins invested of your {settings.max_portfolio_exposure:,} limit.",
            key=f"exposure:{day}",
        )
    db.commit()
    return created


def alert_view(a: Alert) -> dict:
    return {
        "id": a.id,
        "type": a.type,
        "severity": a.severity,
        "title": a.title,
        "message": a.message,
        "reference_id": a.reference_id,
        "created_at": iso(a.created_at),
        "read": a.read_at is not None,
    }


def list_alerts(db: Session, user: User, *, unread_only: bool = False, type: str | None = None, limit: int = 100) -> dict:
    q = select(Alert).where(Alert.user_id == user.id)
    if unread_only:
        q = q.where(Alert.read_at.is_(None))
    if type in ALERT_TYPES:
        q = q.where(Alert.type == type)
    rows = db.scalars(q.order_by(Alert.created_at.desc()).limit(limit)).all()
    unread = db.scalar(select(func.count()).select_from(Alert).where(Alert.user_id == user.id, Alert.read_at.is_(None)))
    return {"items": [alert_view(a) for a in rows], "unread": unread}


def mark_read(db: Session, user: User, alert_id: str | None = None) -> None:
    stmt = update(Alert).where(Alert.user_id == user.id, Alert.read_at.is_(None))
    if alert_id:
        stmt = stmt.where(Alert.id == alert_id)
    db.execute(stmt.values(read_at=utcnow()))
    db.commit()

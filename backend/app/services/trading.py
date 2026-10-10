"""Trade execution and settlement: execute_purchase() and track_and_settle().

Every operation that moves coins runs in one database transaction that updates the
balance, the transfer and the ledger/audit rows together; nothing is committed unless all
of them succeed. Each request carries an idempotency key, so a retried or double-clicked
request returns the original result instead of buying or settling twice. Balance and
transfer rows are optimistically versioned (and row-locked on PostgreSQL), so two
concurrent requests cannot both spend the same coins or sell the same cards.

These are virtual (simulation) or manually recorded transactions. The app never places
real FC 27 transfers.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from ..db import utcnow
from ..engine import TradeValidationError, bp_to_pct, ratio_bp
from ..models import TradeLedgerEntry, Transfer, User
from .common import ServiceError, apply_balance_change, engine_for, get_settings_row, iso, lock_balance, not_found
from .market_data import card_view, get_card, get_or_create_card, stats_for
from .scanner import OPEN_STATUSES, position_cost

KEY_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
STATUSES = ("active", "target_reached", "listed", "sold", "cancelled")


def _check_key(key: str) -> str:
    if not key or not KEY_RE.match(key):
        raise ServiceError(422, "invalid_idempotency_key", "A request id (8-64 letters, digits, - or _) is required.")
    return key


def _engine_error(exc: TradeValidationError) -> ServiceError:
    return ServiceError(409 if exc.code == "already_settled" else 422, exc.code, exc.message)


def get_transfer(db: Session, user: User, transfer_id: str) -> Transfer:
    t = db.get(Transfer, transfer_id)
    if t is None or t.user_id != user.id:
        raise not_found("Transfer")
    return t


# --------------------------------------------------------------------------- purchase


def preview_purchase(db: Session, user: User, *, unit_price: int, quantity: int, card_id: str | None = None) -> dict:
    settings = get_settings_row(db, user)
    balance = lock_balance(db, user)
    existing = position_cost(db, user, card_id) if card_id else 0
    try:
        plan = engine_for(settings).plan_purchase(
            unit_price, quantity, balance.available_coins, balance.invested_coins, existing_position_cost=existing
        )
    except TradeValidationError as exc:
        db.rollback()
        return {"ok": False, "code": exc.code, "message": exc.message}
    db.rollback()
    return {"ok": True, **plan.__dict__, "mode": settings.mode}


def execute_purchase(
    db: Session,
    user: User,
    *,
    idempotency_key: str,
    unit_price: int,
    quantity: int,
    target_sell_price: int,
    card_id: str | None = None,
    player_name: str | None = None,
    mode: str | None = None,
    purchased_at: datetime | None = None,
    notes: str = "",
) -> tuple[dict, bool]:
    """Buy `quantity` cards at `unit_price`. Returns (transfer view, created?)."""
    _check_key(idempotency_key)
    existing = db.scalar(select(Transfer).where(Transfer.user_id == user.id, Transfer.idempotency_key == idempotency_key))
    if existing is not None:
        return transfer_view(db, user, existing), False

    settings = get_settings_row(db, user)
    mode = mode or settings.mode
    if mode not in ("simulation", "manual"):
        raise ServiceError(422, "invalid_mode", "Mode must be simulation or manual.")
    if not isinstance(target_sell_price, int) or target_sell_price <= 0:
        raise ServiceError(422, "invalid_price", "Target sell price must be a positive whole number of coins.")

    if card_id:
        card = get_card(db, user, card_id)
    elif player_name:
        card = get_or_create_card(db, user, player_name)
    else:
        raise ServiceError(422, "card_required", "Choose a card or enter a player name.")

    now = utcnow()
    purchased_at = purchased_at or now
    if purchased_at.tzinfo is None:
        purchased_at = purchased_at.replace(tzinfo=timezone.utc)
    if purchased_at > now + timedelta(minutes=5):
        raise ServiceError(422, "future_timestamp", "Purchase time cannot be in the future.")
    if mode == "simulation" and purchased_at < now - timedelta(minutes=5):
        raise ServiceError(422, "backdated_simulation", "Simulated purchases happen now; use manual mode to record past trades.")

    balance = lock_balance(db, user)
    try:
        plan = engine_for(settings).plan_purchase(
            unit_price,
            quantity,
            balance.available_coins,
            balance.invested_coins,
            existing_position_cost=position_cost(db, user, card.id),
        )
    except TradeValidationError as exc:
        db.rollback()
        raise _engine_error(exc) from exc

    transfer = Transfer(
        user_id=user.id,
        card_id=card.id,
        player_name=card.player_name,
        mode=mode,
        quantity_purchased=quantity,
        quantity_remaining=quantity,
        purchase_price=unit_price,
        target_sell_price=target_sell_price,
        status="active",
        notes=(notes or "")[:1000],
        idempotency_key=idempotency_key,
        purchased_at=purchased_at,
    )
    db.add(transfer)
    db.flush()
    apply_balance_change(
        db,
        balance,
        kind="purchase",
        available_delta=-plan.total_cost,
        invested_delta=plan.total_cost,
        reference_id=transfer.id,
        reason=f"Bought {quantity} x {card.player_name} @ {unit_price:,} ({mode})",
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(Transfer).where(Transfer.user_id == user.id, Transfer.idempotency_key == idempotency_key))
        if existing is not None:
            return transfer_view(db, user, existing), False
        raise
    except StaleDataError as exc:
        db.rollback()
        raise ServiceError(409, "conflict", "Your balance changed while this purchase was processed. Try again.") from exc
    return transfer_view(db, user, transfer), True


# --------------------------------------------------------------------------- settlement


def track_and_settle(
    db: Session,
    user: User,
    transfer_id: str,
    *,
    idempotency_key: str,
    sale_price: int,
    quantity: int,
    sold_at: datetime | None = None,
    notes: str = "",
) -> tuple[dict, bool]:
    """Record a (partial) sale. Returns (ledger entry view, created?)."""
    _check_key(idempotency_key)
    prior = db.scalar(
        select(TradeLedgerEntry).where(TradeLedgerEntry.user_id == user.id, TradeLedgerEntry.idempotency_key == idempotency_key)
    )
    if prior is not None:
        if prior.transfer_id != transfer_id or prior.sale_price != sale_price or prior.quantity != quantity:
            raise ServiceError(409, "idempotency_conflict", "This request id was already used for a different sale.")
        return ledger_view(prior), False

    transfer = db.scalar(
        select(Transfer).where(Transfer.id == transfer_id, Transfer.user_id == user.id).with_for_update()
    )
    if transfer is None:
        raise not_found("Transfer")
    if transfer.status in ("sold", "cancelled") or transfer.quantity_remaining <= 0:
        raise ServiceError(409, "already_settled", f"This transfer is already {transfer.status}; it cannot be settled again.")

    now = utcnow()
    sold_at = sold_at or now
    if sold_at.tzinfo is None:
        sold_at = sold_at.replace(tzinfo=timezone.utc)
    if sold_at > now + timedelta(minutes=5):
        raise ServiceError(422, "future_timestamp", "Sale time cannot be in the future.")
    if sold_at < transfer.purchased_at:
        raise ServiceError(422, "sale_before_purchase", "Sale time cannot be before the purchase time.")

    settings = get_settings_row(db, user)
    try:
        s = engine_for(settings).settle(transfer.purchase_price, transfer.quantity_remaining, quantity, sale_price)
    except TradeValidationError as exc:
        db.rollback()
        raise _engine_error(exc) from exc

    entry = TradeLedgerEntry(
        user_id=user.id,
        transfer_id=transfer.id,
        player_name=transfer.player_name,
        mode=transfer.mode,
        quantity=s.quantity,
        purchase_price=s.purchase_price,
        purchase_cost=s.purchase_cost,
        sale_price=s.sale_price,
        gross_proceeds=s.gross,
        tax=s.tax,
        net_proceeds=s.net,
        realised_profit=s.realised_profit,
        roi_bp=s.roi_bp,
        tax_rate_bp=settings.tax_rate_bp,
        purchased_at=transfer.purchased_at,
        sold_at=sold_at,
        status="settled",
        notes=(notes or "")[:1000],
        idempotency_key=idempotency_key,
    )
    db.add(entry)
    db.flush()
    transfer.quantity_remaining = s.quantity_remaining_after
    if transfer.quantity_remaining == 0:
        transfer.status = "sold"
        transfer.closed_at = sold_at
    balance = lock_balance(db, user)
    apply_balance_change(
        db,
        balance,
        kind="sale",
        available_delta=s.net,
        invested_delta=-s.purchase_cost,
        reference_id=entry.id,
        reason=f"Sold {s.quantity} x {transfer.player_name} @ {sale_price:,} (tax {s.tax:,})",
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        prior = db.scalar(
            select(TradeLedgerEntry).where(TradeLedgerEntry.user_id == user.id, TradeLedgerEntry.idempotency_key == idempotency_key)
        )
        if prior is not None:
            return ledger_view(prior), False
        raise
    except StaleDataError as exc:
        db.rollback()
        raise ServiceError(409, "conflict", "This transfer changed while the sale was processed. Refresh and try again.") from exc
    return ledger_view(entry), True


def cancel_transfer(db: Session, user: User, transfer_id: str, *, reason: str = "") -> dict:
    """Cancel the unsold remainder of a transfer and return its cost to available coins.
    Completed partial sales stay in the ledger."""
    transfer = db.scalar(
        select(Transfer).where(Transfer.id == transfer_id, Transfer.user_id == user.id).with_for_update()
    )
    if transfer is None:
        raise not_found("Transfer")
    if transfer.status in ("sold", "cancelled") or transfer.quantity_remaining <= 0:
        raise ServiceError(409, "already_closed", f"This transfer is already {transfer.status}.")
    refund = transfer.remaining_cost
    transfer.status = "cancelled"
    transfer.closed_at = utcnow()
    balance = lock_balance(db, user)
    apply_balance_change(
        db,
        balance,
        kind="cancel",
        available_delta=refund,
        invested_delta=-refund,
        reference_id=transfer.id,
        reason=f"Cancelled {transfer.quantity_remaining} x {transfer.player_name}" + (f": {reason[:200]}" if reason else ""),
    )
    try:
        db.commit()
    except StaleDataError as exc:
        db.rollback()
        raise ServiceError(409, "conflict", "This transfer changed while it was being cancelled. Refresh and try again.") from exc
    return transfer_view(db, user, transfer)


def update_transfer(db: Session, user: User, transfer_id: str, data: dict) -> dict:
    t = get_transfer(db, user, transfer_id)
    if t.status in ("sold", "cancelled"):
        raise ServiceError(409, "closed", "Closed transfers cannot be edited.")
    if data.get("target_sell_price") is not None:
        v = data["target_sell_price"]
        if not isinstance(v, int) or v <= 0:
            raise ServiceError(422, "invalid_price", "Target sell price must be a positive whole number.")
        t.target_sell_price = v
    if "estimated_price" in data:
        v = data["estimated_price"]
        if v is not None and (not isinstance(v, int) or v <= 0):
            raise ServiceError(422, "invalid_price", "Estimated price must be a positive whole number.")
        t.estimated_price = v
        t.estimated_price_at = utcnow() if v is not None else None
    if data.get("status") is not None:
        if data["status"] not in ("active", "listed"):
            raise ServiceError(422, "invalid_status", "Use 'Record sale' or 'Cancel' to close a transfer.")
        t.status = data["status"]
    if data.get("notes") is not None:
        t.notes = str(data["notes"])[:1000]
    _refresh_target_status(db, user, t)
    try:
        db.commit()
    except StaleDataError as exc:
        db.rollback()
        raise ServiceError(409, "conflict", "This transfer changed in the meantime. Refresh and try again.") from exc
    return transfer_view(db, user, t)


# --------------------------------------------------------------------------- views


def current_estimate(db: Session, user: User, t: Transfer) -> tuple[int, str]:
    """Best current value estimate per card: user's estimate, else latest market price, else cost."""
    stats = stats_for(db, user, t.card)
    candidates = []
    if t.estimated_price is not None and t.estimated_price_at is not None:
        candidates.append((t.estimated_price_at, t.estimated_price, "estimate"))
    if stats.latest_price is not None and stats.latest_at is not None:
        candidates.append((stats.latest_at, stats.latest_price, stats.latest_source or "market"))
    if not candidates:
        return t.purchase_price, "cost"
    _, price, source = max(candidates, key=lambda c: c[0])
    return price, source


def _refresh_target_status(db: Session, user: User, t: Transfer) -> None:
    if t.status not in ("active", "target_reached"):
        return
    price, _ = current_estimate(db, user, t)
    t.status = "target_reached" if price >= t.target_sell_price else "active"


def refresh_statuses(db: Session, user: User) -> None:
    for t in db.scalars(
        select(Transfer).where(Transfer.user_id == user.id, Transfer.status.in_(("active", "target_reached")))
    ).all():
        _refresh_target_status(db, user, t)
    db.commit()


def transfer_view(db: Session, user: User, t: Transfer) -> dict:
    settings = get_settings_row(db, user)
    engine = engine_for(settings, with_limits=False)
    qty = t.quantity_remaining if t.quantity_remaining > 0 else t.quantity_purchased
    invested = t.purchase_price * qty
    expected = engine.sale_breakdown(t.target_sell_price, qty)
    expected_profit = expected.net - invested
    est_price, est_source = current_estimate(db, user, t)
    est_now = engine.sale_breakdown(est_price, qty)
    end = t.closed_at or utcnow()
    sold = t.quantity_purchased - t.quantity_remaining
    ledger = db.scalars(select(TradeLedgerEntry).where(TradeLedgerEntry.transfer_id == t.id).order_by(TradeLedgerEntry.sold_at)).all()
    return {
        "id": t.id,
        "card": card_view(t.card),
        "player_name": t.player_name,
        "mode": t.mode,
        "status": t.status,
        "purchase_price": t.purchase_price,
        "quantity_purchased": t.quantity_purchased,
        "quantity_remaining": t.quantity_remaining,
        "quantity_sold": sold,
        "total_invested": t.purchase_price * t.quantity_remaining,
        "original_cost": t.purchase_price * t.quantity_purchased,
        "target_sell_price": t.target_sell_price,
        "expected_net_proceeds": expected.net,
        "expected_tax": expected.tax,
        "expected_profit": expected_profit,
        "expected_roi_pct": bp_to_pct(ratio_bp(expected_profit, invested)),
        "current_price": est_price,
        "current_price_source": est_source,
        "current_value": est_price * t.quantity_remaining,
        "unrealised_profit": (est_now.net - invested) if t.quantity_remaining else 0,
        "progress_to_target_pct": round(est_price / t.target_sell_price * 100, 1) if t.target_sell_price else None,
        "estimated_price": t.estimated_price,
        "purchased_at": iso(t.purchased_at),
        "closed_at": iso(t.closed_at),
        "holding_hours": round((end - t.purchased_at).total_seconds() / 3600, 2),
        "notes": t.notes,
        "realised_profit": sum(e.realised_profit for e in ledger),
        "sales": [ledger_view(e) for e in ledger],
    }


def list_transfers(db: Session, user: User, *, status: str | None = None, q: str | None = None) -> list[dict]:
    query = select(Transfer).where(Transfer.user_id == user.id)
    if status == "open":
        query = query.where(Transfer.status.in_(OPEN_STATUSES))
    elif status:
        if status not in STATUSES:
            raise ServiceError(422, "invalid_status", "Unknown status filter.")
        query = query.where(Transfer.status == status)
    if q:
        query = query.where(Transfer.player_name.ilike(f"%{q}%"))
    rows = db.scalars(query.order_by(Transfer.purchased_at.desc())).all()
    return [transfer_view(db, user, t) for t in rows]


def ledger_view(e: TradeLedgerEntry) -> dict:
    return {
        "id": e.id,
        "transfer_id": e.transfer_id,
        "player_name": e.player_name,
        "mode": e.mode,
        "quantity": e.quantity,
        "purchase_price": e.purchase_price,
        "purchase_cost": e.purchase_cost,
        "sale_price": e.sale_price,
        "gross_proceeds": e.gross_proceeds,
        "tax": e.tax,
        "tax_rate_pct": bp_to_pct(e.tax_rate_bp),
        "net_proceeds": e.net_proceeds,
        "realised_profit": e.realised_profit,
        "roi_pct": bp_to_pct(e.roi_bp),
        "purchased_at": iso(e.purchased_at),
        "sold_at": iso(e.sold_at),
        "holding_hours": round((e.sold_at - e.purchased_at).total_seconds() / 3600, 2),
        "status": e.status,
        "notes": e.notes,
    }


LEDGER_SORTS = {
    "sold_at": TradeLedgerEntry.sold_at,
    "profit": TradeLedgerEntry.realised_profit,
    "roi": TradeLedgerEntry.roi_bp,
    "player": TradeLedgerEntry.player_name,
    "net": TradeLedgerEntry.net_proceeds,
}


def list_ledger(
    db: Session,
    user: User,
    *,
    q: str | None = None,
    outcome: str | None = None,
    sort: str = "sold_at",
    desc: bool = True,
    page: int = 1,
    page_size: int = 25,
) -> dict:
    from sqlalchemy import func

    query = select(TradeLedgerEntry).where(TradeLedgerEntry.user_id == user.id)
    if q:
        query = query.where(TradeLedgerEntry.player_name.ilike(f"%{q}%"))
    if outcome == "win":
        query = query.where(TradeLedgerEntry.realised_profit > 0)
    elif outcome == "loss":
        query = query.where(TradeLedgerEntry.realised_profit < 0)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    col = LEDGER_SORTS.get(sort, TradeLedgerEntry.sold_at)
    page_size = max(1, min(page_size, 200))
    page = max(1, page)
    rows = db.scalars(
        query.order_by(col.desc() if desc else col.asc(), TradeLedgerEntry.id).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return {"items": [ledger_view(e) for e in rows], "total": total, "page": page, "page_size": page_size}

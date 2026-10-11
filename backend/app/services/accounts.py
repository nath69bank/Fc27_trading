"""Users, settings, balances and the auditable balance-adjustment workflow."""

from __future__ import annotations

import re

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..engine import bp_to_pct
from ..models import AccountBalance, BalanceEvent, User, UserSettings
from ..security import hash_password
from .common import ServiceError, apply_balance_change, get_settings_row, iso, lock_balance

USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,64}$")

ALERT_TYPES = (
    "below_target_buy",
    "target_sell_reached",
    "profit_threshold",
    "holding_limit",
    "stale_data",
    "exposure_limit",
)
DEFAULT_ALERT_PREFS = {t: True for t in ALERT_TYPES}
MODES = ("simulation", "manual")
# Xbox and PlayStation share one console transfer market; PC is separate.
PLATFORMS = ("console", "pc")
SELL_STRATEGIES = ("target_price", "historical_high", "quick_flip")


GUEST_PASSWORD_HASH = "!guest"  # matches no password: guests only ever sign in with their session token


def create_user(
    db: Session, username: str, password: str | None, *, is_demo: bool = False, starting_coins: int = 150_000
) -> User:
    """Create a user with an opening balance. password=None creates a guest that cannot log in
    with a password (and skips the deliberately slow hash)."""
    if not USERNAME_RE.match(username):
        raise ServiceError(422, "invalid_username", "Username must be 3-64 letters, numbers, dots, dashes or underscores.")
    if password is not None and len(password) < 8:
        raise ServiceError(422, "weak_password", "Password must be at least 8 characters.")
    if starting_coins < 0:
        raise ServiceError(422, "invalid_amount", "Starting coins cannot be negative.")
    if db.scalar(select(func.count()).select_from(User).where(func.lower(User.username) == username.lower())):
        raise ServiceError(409, "username_taken", "That username is already registered.")
    pw_hash = hash_password(password) if password is not None else GUEST_PASSWORD_HASH
    user = User(username=username, password_hash=pw_hash, is_demo=is_demo)
    try:
        db.add(user)
        db.flush()  # a concurrent registration of the same name fails here, not at commit
        db.add(UserSettings(user_id=user.id, starting_coins=starting_coins, alert_prefs=dict(DEFAULT_ALERT_PREFS)))
        balance = AccountBalance(user_id=user.id, available_coins=0, invested_coins=0)
        db.add(balance)
        db.flush()
        apply_balance_change(
            db, balance, kind="opening", available_delta=starting_coins, invested_delta=0, reason="Opening balance"
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ServiceError(409, "username_taken", "That username is already registered.") from exc
    return user


def balance_view(db: Session, user: User) -> dict:
    b = db.get(AccountBalance, user.id)
    return {
        "available_coins": b.available_coins,
        "invested_coins": b.invested_coins,
        "updated_at": iso(b.updated_at),
    }


def settings_view(s: UserSettings) -> dict:
    prefs = {**DEFAULT_ALERT_PREFS, **(s.alert_prefs or {})}
    return {
        "starting_coins": s.starting_coins,
        "tax_rate_pct": bp_to_pct(s.tax_rate_bp),
        "min_profit": s.min_profit,
        "min_roi_pct": bp_to_pct(s.min_roi_bp),
        "entry_threshold_pct": bp_to_pct(s.entry_threshold_bp),
        "max_investment_per_card": s.max_investment_per_card,
        "max_portfolio_exposure": s.max_portfolio_exposure,
        "exposure_warning_pct": bp_to_pct(s.exposure_warning_bp),
        "default_sell_strategy": s.default_sell_strategy,
        "platform": s.platform,
        "stale_after_hours": s.stale_after_hours,
        "refresh_minutes": s.refresh_minutes,
        "holding_limit_hours": s.holding_limit_hours,
        "max_volatility_pct": bp_to_pct(s.max_volatility_bp),
        "mode": s.mode,
        "alert_prefs": prefs,
        "updated_at": iso(s.updated_at),
    }


def _pct_to_bp(value: float, *, lo: float, hi: float, name: str) -> int:
    if value is None or not (lo <= value <= hi):
        raise ServiceError(422, "invalid_setting", f"{name} must be between {lo:g}% and {hi:g}%.")
    return round(value * 100)


def update_settings(db: Session, user: User, data: dict) -> dict:
    """Update trading settings. Changing starting_coins never touches balances or history;
    use adjust_balance() to move coins (it is journaled)."""
    s = get_settings_row(db, user)
    pct_fields = {
        "tax_rate_pct": ("tax_rate_bp", 0, 50, "Tax rate"),
        "min_roi_pct": ("min_roi_bp", 0, 1000, "Minimum ROI"),
        "entry_threshold_pct": ("entry_threshold_bp", 50, 200, "Entry threshold"),
        "exposure_warning_pct": ("exposure_warning_bp", 10, 100, "Exposure warning level"),
        "max_volatility_pct": ("max_volatility_bp", 1, 500, "Maximum volatility"),
    }
    for key, (col, lo, hi, name) in pct_fields.items():
        if data.get(key) is not None:
            setattr(s, col, _pct_to_bp(float(data[key]), lo=lo, hi=hi, name=name))
    int_fields = {
        "starting_coins": (0, 10**12),
        "min_profit": (0, 10**9),
        "max_investment_per_card": (1, 10**12),
        "max_portfolio_exposure": (1, 10**12),
        "stale_after_hours": (1, 24 * 30),
        "refresh_minutes": (1, 24 * 60),
        "holding_limit_hours": (1, 24 * 90),
    }
    for key, (lo, hi) in int_fields.items():
        if data.get(key) is not None:
            value = int(data[key])
            if not lo <= value <= hi:
                raise ServiceError(422, "invalid_setting", f"{key.replace('_', ' ').capitalize()} must be between {lo:,} and {hi:,}.")
            setattr(s, key, value)
    choice_fields = {"mode": MODES, "platform": PLATFORMS, "default_sell_strategy": SELL_STRATEGIES}
    for key, allowed in choice_fields.items():
        if data.get(key) is not None:
            if data[key] not in allowed:
                raise ServiceError(422, "invalid_setting", f"{key} must be one of: {', '.join(allowed)}.")
            setattr(s, key, data[key])
    if data.get("alert_prefs") is not None:
        prefs = {**DEFAULT_ALERT_PREFS, **(s.alert_prefs or {})}
        for key, value in data["alert_prefs"].items():
            if key not in ALERT_TYPES:
                raise ServiceError(422, "invalid_setting", f"Unknown alert type: {key}.")
            prefs[key] = bool(value)
        s.alert_prefs = prefs
    db.commit()
    return settings_view(s)


def adjust_balance(db: Session, user: User, amount: int, reason: str) -> dict:
    """Add or remove available coins outside of trading, with a mandatory reason (audited)."""
    if not isinstance(amount, int) or amount == 0:
        raise ServiceError(422, "invalid_amount", "Adjustment must be a non-zero whole number of coins.")
    reason = (reason or "").strip()
    if len(reason) < 3:
        raise ServiceError(422, "reason_required", "Give a reason for the adjustment (at least 3 characters).")
    balance = lock_balance(db, user)
    event = apply_balance_change(
        db, balance, kind="adjustment", available_delta=amount, invested_delta=0, reason=reason[:500]
    )
    db.commit()
    return event_view(event)


def event_view(e: BalanceEvent) -> dict:
    return {
        "id": e.id,
        "kind": e.kind,
        "available_delta": e.available_delta,
        "invested_delta": e.invested_delta,
        "available_after": e.available_after,
        "invested_after": e.invested_after,
        "reference_id": e.reference_id,
        "reason": e.reason,
        "created_at": iso(e.created_at),
    }


def list_events(db: Session, user: User, *, kind: str | None = None, limit: int = 100) -> list[dict]:
    q = select(BalanceEvent).where(BalanceEvent.user_id == user.id)
    if kind:
        q = q.where(BalanceEvent.kind == kind)
    rows = db.scalars(q.order_by(BalanceEvent.created_at.desc(), BalanceEvent.id.desc()).limit(limit)).all()
    return [event_view(e) for e in rows]


def reconcile(db: Session, user: User) -> dict:
    """Re-derive balances from the audit journal and compare with the stored balance."""
    from ..models import Transfer  # local import to avoid a cycle at module load

    b = db.get(AccountBalance, user.id)
    sums = db.execute(
        select(func.coalesce(func.sum(BalanceEvent.available_delta), 0), func.coalesce(func.sum(BalanceEvent.invested_delta), 0)).where(
            BalanceEvent.user_id == user.id
        )
    ).one()
    open_cost = db.scalar(
        select(func.coalesce(func.sum(Transfer.quantity_remaining * Transfer.purchase_price), 0)).where(
            Transfer.user_id == user.id, Transfer.status.notin_(("sold", "cancelled"))
        )
    )
    journal_available, journal_invested = int(sums[0]), int(sums[1])
    return {
        "stored_available": b.available_coins,
        "stored_invested": b.invested_coins,
        "journal_available": journal_available,
        "journal_invested": journal_invested,
        "open_transfer_cost": int(open_cost),
        "balanced": b.available_coins == journal_available
        and b.invested_coins == journal_invested == int(open_cost),
    }

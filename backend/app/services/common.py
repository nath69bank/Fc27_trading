"""Helpers shared by the services: errors, engine construction, balance locking and journaling."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..db import utcnow
from ..engine import EngineConfig, FC27MarketEngine
from ..models import AccountBalance, BalanceEvent, User, UserSettings


class ServiceError(Exception):
    """An expected failure with an HTTP status and a stable, user-safe code."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def not_found(what: str) -> ServiceError:
    return ServiceError(404, "not_found", f"{what} not found.")


def get_settings_row(db: Session, user: User) -> UserSettings:
    row = db.get(UserSettings, user.id)
    if row is None:
        raise ServiceError(500, "missing_settings", "User settings are missing.")
    return row


def engine_for(settings: UserSettings, *, with_limits: bool = True) -> FC27MarketEngine:
    return FC27MarketEngine(
        EngineConfig(
            tax_rate_bp=settings.tax_rate_bp,
            entry_threshold_bp=settings.entry_threshold_bp,
            min_profit=settings.min_profit,
            min_roi_bp=settings.min_roi_bp,
            stale_after=timedelta(hours=settings.stale_after_hours),
            max_volatility_bp=settings.max_volatility_bp,
            max_investment_per_card=settings.max_investment_per_card if with_limits else None,
            max_portfolio_exposure=settings.max_portfolio_exposure if with_limits else None,
        )
    )


def lock_balance(db: Session, user: User) -> AccountBalance:
    """Serialise every coin-moving operation for this account, and return its balance row.

    PostgreSQL takes a row lock (FOR UPDATE). The version bump then claims the row with a
    compare-and-set: on SQLite, which has no row locks, that write takes the database write
    lock up front, so everything the caller reads afterwards is current until it commits.
    If another request changed the balance in between, this fails with a retryable 409.
    Call it before reading any transfer state the operation depends on."""
    row = db.scalar(select(AccountBalance).where(AccountBalance.user_id == user.id).with_for_update())
    if row is None:
        raise ServiceError(500, "missing_balance", "Account balance is missing.")
    claimed = db.execute(
        update(AccountBalance)
        .where(AccountBalance.user_id == user.id, AccountBalance.version == row.version)
        .values(version=row.version + 1)
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        db.rollback()
        raise ServiceError(409, "conflict", "Your balance changed while this request was processed. Try again.")
    db.refresh(row)
    return row


def apply_balance_change(
    db: Session,
    balance: AccountBalance,
    *,
    kind: str,
    available_delta: int,
    invested_delta: int,
    reference_id: str | None = None,
    reason: str = "",
    at: datetime | None = None,
) -> BalanceEvent:
    """Change a balance and write the matching audit event. Caller commits (one transaction)."""
    new_available = balance.available_coins + available_delta
    new_invested = balance.invested_coins + invested_delta
    if new_available < 0:
        raise ServiceError(422, "insufficient_coins", "This change would make available coins negative.")
    if new_invested < 0:
        raise ServiceError(500, "invested_negative", "Invested coins cannot go negative; ledger is inconsistent.")
    balance.available_coins = new_available
    balance.invested_coins = new_invested
    event = BalanceEvent(
        user_id=balance.user_id,
        kind=kind,
        available_delta=available_delta,
        invested_delta=invested_delta,
        available_after=new_available,
        invested_after=new_invested,
        reference_id=reference_id,
        reason=reason,
        created_at=at or utcnow(),
    )
    db.add(event)
    return event


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()

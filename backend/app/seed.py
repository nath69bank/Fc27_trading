"""Demo dataset. Everything seeded here is clearly labelled demo/sample data: the player
names are generic placeholders, not real FC 27 cards, and the prices are invented for
illustration — they are not market prices."""

from __future__ import annotations

import secrets
from datetime import timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .db import utcnow
from .models import (
    AccountBalance,
    Alert,
    AuthSession,
    BalanceEvent,
    Card,
    MarketPrice,
    OpportunityEvaluation,
    TradeLedgerEntry,
    Transfer,
    User,
    UserSettings,
    WatchlistItem,
)
from .services.accounts import create_user
from .services.common import ServiceError
from .services.market_data import seed_sample_history
from .services.watchlist import add_to_watchlist

DEMO_WATCHLIST = [
    # name, version, rating, position, target buy, target sell, sample low, sample high, sample current
    ("Meta Gold Winger", "Demo Gold Rare", 86, "RW", 25_000, 32_000, 25_000, 32_000, 25_200),
    ("High-Rated Fodder 88", "Demo Gold Rare", 88, "CM", 11_000, 15_500, 11_000, 15_500, 13_750),
]


def seed_demo_data(db: Session, user: User) -> None:
    for name, version, rating, pos, buy, sell, low, high, current in DEMO_WATCHLIST:
        item = add_to_watchlist(
            db, user, player_name=name, version=version, rating=rating, position=pos,
            target_buy=buy, target_sell=sell, is_demo=True,
            notes="Demo record — editable. Prices are sample data, not real FC 27 market prices.",
        )
        seed_sample_history(db, user, item.card, low=low, high=high, current=current)
    db.commit()


def create_demo_account(db: Session, username: str | None = None, password: str | None = None) -> User:
    """Create a freshly seeded demo account (150,000 starting coins).

    Without a password this is a guest desk: reachable only through its session token."""
    username = username or f"guest-{secrets.token_hex(5)}"
    user = create_user(db, username, password, is_demo=True, starting_coins=150_000)
    seed_demo_data(db, user)
    return user


def prune_abandoned_guests(db: Session, *, idle_days: int = 30, limit: int = 50) -> int:
    """Delete guest desks nobody can reach any more: no live session and older than idle_days.

    Rows are removed children-first so foreign keys hold on every database."""
    cutoff = utcnow() - timedelta(days=idle_days)
    live = select(AuthSession.user_id).where(AuthSession.expires_at > utcnow())
    ids = db.scalars(
        select(User.id)
        .where(User.is_demo.is_(True), User.username.like("guest-%"), User.created_at < cutoff, User.id.notin_(live))
        .limit(limit)
    ).all()
    if not ids:
        return 0
    card_ids = select(Card.id).where(Card.user_id.in_(ids))
    for stmt in (
        delete(TradeLedgerEntry).where(TradeLedgerEntry.user_id.in_(ids)),
        delete(Transfer).where(Transfer.user_id.in_(ids)),
        delete(Alert).where(Alert.user_id.in_(ids)),
        delete(OpportunityEvaluation).where(OpportunityEvaluation.user_id.in_(ids)),
        delete(WatchlistItem).where(WatchlistItem.user_id.in_(ids)),
        delete(MarketPrice).where(MarketPrice.card_id.in_(card_ids)),
        delete(Card).where(Card.user_id.in_(ids)),
        delete(BalanceEvent).where(BalanceEvent.user_id.in_(ids)),
        delete(AuthSession).where(AuthSession.user_id.in_(ids)),
        delete(UserSettings).where(UserSettings.user_id.in_(ids)),
        delete(AccountBalance).where(AccountBalance.user_id.in_(ids)),
        delete(User).where(User.id.in_(ids)),
    ):
        db.execute(stmt.execution_options(synchronize_session=False))
    db.commit()
    return len(ids)


def ensure_shared_demo_user(db: Session, password: str) -> None:
    if db.scalar(select(User).where(User.username == "demo")) is not None:
        return
    try:
        create_demo_account(db, "demo", password)
    except ServiceError as exc:  # another instance seeded it first
        db.rollback()
        if exc.code != "username_taken":
            raise

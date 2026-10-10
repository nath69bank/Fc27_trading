"""Demo dataset. Everything seeded here is clearly labelled demo/sample data: the player
names are generic placeholders, not real FC 27 cards, and the prices are invented for
illustration — they are not market prices."""

from __future__ import annotations

import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import User
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


def create_demo_account(db: Session, username: str | None = None, password: str | None = None) -> tuple[User, str]:
    """Create a freshly seeded demo account (150,000 starting coins). Returns (user, password)."""
    username = username or f"demo-{secrets.token_hex(4)}"
    password = password or secrets.token_urlsafe(12)
    user = create_user(db, username, password, is_demo=True, starting_coins=150_000)
    seed_demo_data(db, user)
    return user, password


def ensure_shared_demo_user(db: Session, password: str) -> None:
    if db.scalar(select(User).where(User.username == "demo")) is not None:
        return
    try:
        create_demo_account(db, "demo", password)
    except ServiceError as exc:  # another instance seeded it first
        db.rollback()
        if exc.code != "username_taken":
            raise

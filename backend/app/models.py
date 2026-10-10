"""SQLAlchemy models.

Coin amounts are whole coins stored as integers (BigInteger). Rates and percentages are
stored as integer basis points (1 bp = 0.01%), e.g. a 5% tax is 500 and a 20.63% ROI is
2063, so every stored number is exact and every rounding step happens in one place
(app/engine/market_engine.py).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, UTCDateTime, utcnow


def new_id() -> str:
    return uuid.uuid4().hex


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    settings: Mapped["UserSettings"] = relationship(back_populates="user", uselist=False)
    balance: Mapped["AccountBalance"] = relationship(back_populates="user", uselist=False)


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    # sha256 of the bearer token; the raw token is only ever held by the client.
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)


class UserSettings(Base):
    __tablename__ = "user_settings"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    starting_coins: Mapped[int] = mapped_column(BigInteger, default=150_000)
    tax_rate_bp: Mapped[int] = mapped_column(Integer, default=500)
    min_profit: Mapped[int] = mapped_column(BigInteger, default=1_000)
    min_roi_bp: Mapped[int] = mapped_column(Integer, default=0)
    entry_threshold_bp: Mapped[int] = mapped_column(Integer, default=10_200)  # 102% of historical low
    max_investment_per_card: Mapped[int] = mapped_column(BigInteger, default=100_000)
    max_portfolio_exposure: Mapped[int] = mapped_column(BigInteger, default=120_000)
    exposure_warning_bp: Mapped[int] = mapped_column(Integer, default=8_000)  # warn at 80% of limit
    default_sell_strategy: Mapped[str] = mapped_column(String(32), default="target_price")
    platform: Mapped[str] = mapped_column(String(16), default="cross")
    stale_after_hours: Mapped[int] = mapped_column(Integer, default=24)
    refresh_minutes: Mapped[int] = mapped_column(Integer, default=15)
    holding_limit_hours: Mapped[int] = mapped_column(Integer, default=72)
    max_volatility_bp: Mapped[int] = mapped_column(Integer, default=2_500)  # RISK above 25% CV
    mode: Mapped[str] = mapped_column(String(16), default="simulation")
    alert_prefs: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    user: Mapped[User] = relationship(back_populates="settings")


class AccountBalance(Base):
    __tablename__ = "account_balances"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    available_coins: Mapped[int] = mapped_column(BigInteger, default=0)
    invested_coins: Mapped[int] = mapped_column(BigInteger, default=0)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    user: Mapped[User] = relationship(back_populates="balance")

    # Optimistic locking: two concurrent writers cannot both apply a change to the same row.
    __mapper_args__ = {"version_id_col": version}


class BalanceEvent(Base):
    """Append-only audit journal: one row for every change to an account balance."""

    __tablename__ = "balance_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # opening | adjustment | purchase | sale | cancel
    kind: Mapped[str] = mapped_column(String(16))
    available_delta: Mapped[int] = mapped_column(BigInteger, default=0)
    invested_delta: Mapped[int] = mapped_column(BigInteger, default=0)
    available_after: Mapped[int] = mapped_column(BigInteger)
    invested_after: Mapped[int] = mapped_column(BigInteger)
    reference_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)


class Card(Base):
    """A player card the user tracks. Cards are user-scoped: names are user-entered, not an
    official FC 27 catalogue."""

    __tablename__ = "cards"
    __table_args__ = (UniqueConstraint("user_id", "card_key", name="uq_cards_user_key"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    card_key: Mapped[str] = mapped_column(String(160))
    player_name: Mapped[str] = mapped_column(String(120))
    version: Mapped[str | None] = mapped_column(String(60), nullable=True)
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    position: Mapped[str | None] = mapped_column(String(8), nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class MarketPrice(Base):
    __tablename__ = "market_prices"
    __table_args__ = (Index("ix_market_prices_card_time", "card_id", "observed_at"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    card_id: Mapped[str] = mapped_column(ForeignKey("cards.id", ondelete="CASCADE"))
    platform: Mapped[str] = mapped_column(String(16), default="cross")
    price: Mapped[int] = mapped_column(BigInteger)
    # manual | csv | sample | simulated | live
    source: Mapped[str] = mapped_column(String(16))
    observed_at: Mapped[datetime] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    card: Mapped[Card] = relationship()


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"
    __table_args__ = (UniqueConstraint("user_id", "card_id", name="uq_watchlist_user_card"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    card_id: Mapped[str] = mapped_column(ForeignKey("cards.id", ondelete="CASCADE"))
    target_buy: Mapped[int] = mapped_column(BigInteger)
    target_sell: Mapped[int] = mapped_column(BigInteger)
    favourite: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str] = mapped_column(Text, default="")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    card: Mapped[Card] = relationship()


class OpportunityEvaluation(Base):
    """A recorded run of evaluate_opportunity(), for the signal feed and audit trail."""

    __tablename__ = "opportunity_evaluations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    card_id: Mapped[str | None] = mapped_column(ForeignKey("cards.id", ondelete="SET NULL"), nullable=True)
    player_name: Mapped[str] = mapped_column(String(120))
    signal: Mapped[str] = mapped_column(String(8))
    current_price: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    estimated_profit: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    roi_bp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    data_source: Mapped[str | None] = mapped_column(String(16), nullable=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)


class Transfer(Base):
    __tablename__ = "transfers"
    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_transfers_idempotency"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    card_id: Mapped[str] = mapped_column(ForeignKey("cards.id", ondelete="RESTRICT"))
    player_name: Mapped[str] = mapped_column(String(120))
    # simulation | manual
    mode: Mapped[str] = mapped_column(String(16))
    quantity_purchased: Mapped[int] = mapped_column(Integer)
    quantity_remaining: Mapped[int] = mapped_column(Integer)
    purchase_price: Mapped[int] = mapped_column(BigInteger)
    target_sell_price: Mapped[int] = mapped_column(BigInteger)
    estimated_price: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    estimated_price_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    # active | target_reached | listed | sold | cancelled
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    idempotency_key: Mapped[str] = mapped_column(String(64))
    purchased_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    card: Mapped[Card] = relationship()

    __mapper_args__ = {"version_id_col": version}

    @property
    def remaining_cost(self) -> int:
        return self.quantity_remaining * self.purchase_price


class TradeLedgerEntry(Base):
    __tablename__ = "trade_ledger"
    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_ledger_idempotency"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    transfer_id: Mapped[str] = mapped_column(ForeignKey("transfers.id", ondelete="RESTRICT"), index=True)
    player_name: Mapped[str] = mapped_column(String(120))
    mode: Mapped[str] = mapped_column(String(16))
    quantity: Mapped[int] = mapped_column(Integer)
    purchase_price: Mapped[int] = mapped_column(BigInteger)
    purchase_cost: Mapped[int] = mapped_column(BigInteger)
    sale_price: Mapped[int] = mapped_column(BigInteger)
    gross_proceeds: Mapped[int] = mapped_column(BigInteger)
    tax: Mapped[int] = mapped_column(BigInteger)
    net_proceeds: Mapped[int] = mapped_column(BigInteger)
    realised_profit: Mapped[int] = mapped_column(BigInteger)
    roi_bp: Mapped[int] = mapped_column(Integer)
    tax_rate_bp: Mapped[int] = mapped_column(Integer)
    purchased_at: Mapped[datetime] = mapped_column(UTCDateTime)
    sold_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    status: Mapped[str] = mapped_column(String(16), default="settled")
    notes: Mapped[str] = mapped_column(Text, default="")
    idempotency_key: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (UniqueConstraint("user_id", "dedupe_key", name="uq_alerts_dedupe"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # below_target_buy | target_sell_reached | profit_threshold | holding_limit | stale_data | exposure_limit
    type: Mapped[str] = mapped_column(String(32))
    severity: Mapped[str] = mapped_column(String(8), default="info")  # info | success | warning | danger
    title: Mapped[str] = mapped_column(String(160))
    message: Mapped[str] = mapped_column(Text)
    reference_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    dedupe_key: Mapped[str] = mapped_column(String(160))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    read_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

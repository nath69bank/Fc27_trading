"""Request bodies. Responses are plain dicts built by the services' *_view() helpers.

Coin fields are validated here (shape) and again in the services/engine (business rules);
the server never accepts client-computed profits or balances."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Coins = Annotated[int, Field(gt=0, le=15_000_000)]
Qty = Annotated[int, Field(gt=0, le=100)]
Key = Annotated[str, Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]


class Body(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Credentials(Body):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=256)


class WatchlistCreate(Body):
    player_name: str = Field(min_length=1, max_length=120)
    version: str | None = Field(default=None, max_length=60)
    rating: int | None = Field(default=None, ge=1, le=99)
    position: str | None = Field(default=None, max_length=8)
    image_url: str | None = Field(default=None, max_length=500)
    target_buy: Coins
    target_sell: Coins
    current_price: Coins | None = None
    notes: str = Field(default="", max_length=1000)


class WatchlistUpdate(Body):
    target_buy: Coins | None = None
    target_sell: Coins | None = None
    favourite: bool | None = None
    notes: str | None = Field(default=None, max_length=1000)
    image_url: str | None = Field(default=None, max_length=500)
    position: str | None = Field(default=None, max_length=8)


class ManualEvaluation(Body):
    player_name: str = Field(min_length=1, max_length=120)
    current_price: Coins | None = None
    historical_low: Coins | None = None
    historical_high: Coins | None = None
    price_history: list[int] | None = Field(default=None, max_length=1000)
    expected_sell_price: Coins | None = None
    max_buy_threshold_pct: float | None = None
    min_profit: int | None = Field(default=None, ge=0)
    min_roi_pct: float | None = Field(default=None, ge=0)
    quantity: Qty = 1


class PriceCreate(Body):
    card_id: str | None = None
    player_name: str | None = Field(default=None, max_length=120)
    price: Coins
    observed_at: datetime | None = None
    platform: Literal["cross", "playstation", "xbox", "pc"] | None = None


class CsvImport(Body):
    csv: str = Field(min_length=1, max_length=2_000_000)


class PurchasePreview(Body):
    unit_price: Coins
    quantity: Qty
    card_id: str | None = None


class PurchaseCreate(Body):
    idempotency_key: Key
    card_id: str | None = None
    player_name: str | None = Field(default=None, max_length=120)
    unit_price: Coins
    quantity: Qty
    target_sell_price: Coins
    mode: Literal["simulation", "manual"] | None = None
    purchased_at: datetime | None = None
    notes: str = Field(default="", max_length=1000)


class TransferUpdate(Body):
    target_sell_price: Coins | None = None
    estimated_price: Coins | None = None
    clear_estimate: bool = False
    status: Literal["active", "listed"] | None = None
    notes: str | None = Field(default=None, max_length=1000)


class SaleCreate(Body):
    idempotency_key: Key
    sale_price: Coins
    quantity: Qty
    sold_at: datetime | None = None
    notes: str = Field(default="", max_length=1000)


class SalePreview(Body):
    sale_price: Coins
    quantity: Qty


class CancelRequest(Body):
    reason: str = Field(default="", max_length=200)


class SettingsUpdate(Body):
    starting_coins: int | None = None
    tax_rate_pct: float | None = None
    min_profit: int | None = None
    min_roi_pct: float | None = None
    entry_threshold_pct: float | None = None
    max_investment_per_card: int | None = None
    max_portfolio_exposure: int | None = None
    exposure_warning_pct: float | None = None
    default_sell_strategy: str | None = None
    platform: str | None = None
    stale_after_hours: int | None = None
    refresh_minutes: int | None = None
    holding_limit_hours: int | None = None
    max_volatility_pct: float | None = None
    mode: str | None = None
    alert_prefs: dict[str, bool] | None = None


class BalanceAdjustment(Body):
    amount: int = Field(ne=0, ge=-10**12, le=10**12)
    reason: str = Field(min_length=3, max_length=500)

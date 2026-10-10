"""FC27MarketEngine — the trading calculations behind every screen.

This module is deliberately pure: no database, no HTTP, no clock unless one is passed in.
The service layer (app/services) loads records, calls the engine, and persists results, so
the same rules apply everywhere and the maths can be tested in isolation.

Rounding policy (applies to every coin figure in the application):
  * Coins are whole integers. Intermediate maths uses Decimal.
  * Transfer-market tax is rounded half-up to the nearest whole coin, and
    net proceeds = gross proceeds - tax (so gross = net + tax always reconciles).
  * Price thresholds that cap what you should pay (entry threshold, suggested maximum
    buy) are rounded *down*, so a suggestion never exceeds the configured rule.
  * Percentages (ROI, win rate) are rounded half-up to two decimal places and stored as
    integer basis points (1 bp = 0.01%).

Nothing here predicts the future: estimates assume a card can be resold at an expected
price derived from user-supplied or historical data, which is never guaranteed.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal

BP = 10_000  # basis points in 100%

SIGNAL_BUY = "BUY"
SIGNAL_HOLD = "HOLD"
SIGNAL_SELL = "SELL"
SIGNAL_WATCH = "WATCH"
SIGNAL_RISK = "RISK"

DISCLAIMER = (
    "Estimate based on historical and user-supplied prices. Past prices do not guarantee "
    "future selling prices; this is not a guaranteed profit."
)


class TradeValidationError(ValueError):
    """A trade request broke a rule. `code` is stable and safe to show to users."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# --------------------------------------------------------------------------- rounding


def round_coins(value: Decimal | int) -> int:
    return int(Decimal(value).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def floor_coins(value: Decimal | int) -> int:
    return int(Decimal(value).quantize(Decimal(1), rounding=ROUND_FLOOR))


def ratio_bp(numerator: int | Decimal, denominator: int | Decimal) -> int:
    """numerator / denominator as basis points, rounded half-up. 0 when denominator is 0."""
    if not denominator:
        return 0
    return round_coins(Decimal(numerator) * BP / Decimal(denominator))


def bp_to_pct(bp: int | None) -> float | None:
    return None if bp is None else bp / 100


# --------------------------------------------------------------------------- config


@dataclass(frozen=True)
class EngineConfig:
    tax_rate_bp: int = 500  # 5% transfer-market tax
    entry_threshold_bp: int = 10_200  # buy at no more than 102% of the historical low
    min_profit: int = 1_000  # minimum estimated profit after tax, in coins
    min_roi_bp: int = 0  # minimum estimated ROI
    stale_after: timedelta = timedelta(hours=24)
    max_volatility_bp: int = 2_500  # coefficient of variation above which history is unreliable
    max_investment_per_card: int | None = None  # coins in one card (existing position + new buy)
    max_portfolio_exposure: int | None = None  # total invested coins across open transfers

    def __post_init__(self):
        if not 0 <= self.tax_rate_bp < BP:
            raise ValueError("tax_rate_bp must be between 0 and 9999")
        if self.entry_threshold_bp <= 0:
            raise ValueError("entry_threshold_bp must be positive")
        if self.min_profit < 0 or self.min_roi_bp < 0:
            raise ValueError("minimum profit and ROI cannot be negative")


# --------------------------------------------------------------------------- results


@dataclass(frozen=True)
class SaleBreakdown:
    gross: int
    tax: int
    net: int


@dataclass
class Opportunity:
    player_name: str
    signal: str
    current_price: int | None
    historical_low: int | None
    historical_high: int | None
    entry_threshold_price: int | None
    suggested_max_buy: int | None
    expected_sell_price: int | None
    expected_net_proceeds: int | None
    estimated_profit: int | None
    roi_bp: int | None
    volatility_bp: int | None
    data_source: str | None
    observed_at: datetime | None
    data_age_hours: float | None
    is_stale: bool
    checks: dict[str, bool | None]
    reasons: list[str]
    explanation: str
    disclaimer: str = DISCLAIMER

    @property
    def roi_pct(self) -> float | None:
        return bp_to_pct(self.roi_bp)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["roi_pct"] = self.roi_pct
        d["observed_at"] = self.observed_at.isoformat() if self.observed_at else None
        return d


@dataclass(frozen=True)
class PurchasePlan:
    unit_price: int
    quantity: int
    total_cost: int
    available_before: int
    available_after: int
    invested_before: int
    invested_after: int


@dataclass(frozen=True)
class Settlement:
    quantity: int
    purchase_price: int
    purchase_cost: int
    sale_price: int
    gross: int
    tax: int
    net: int
    realised_profit: int
    roi_bp: int
    quantity_remaining_after: int


@dataclass(frozen=True)
class TradeRecord:
    """The fields of a settled trade the performance report needs."""

    player_name: str
    quantity: int
    purchase_cost: int
    net_proceeds: int
    realised_profit: int
    roi_bp: int
    purchased_at: datetime
    sold_at: datetime
    id: str = ""


@dataclass
class PerformanceReport:
    total_trades: int
    profitable_trades: int
    losing_trades: int
    breakeven_trades: int
    win_rate_bp: int
    total_realised_profit: int  # sum of winning trades
    total_realised_losses: int  # sum of losing trades, as a positive number
    net_realised_profit: int
    total_cost_basis: int
    trading_roi_bp: int  # net realised profit / cost basis of settled trades
    average_profit_per_trade: int
    average_roi_bp: int
    best_trade: dict | None
    worst_trade: dict | None
    average_holding_hours: float | None
    available_coins: int
    invested_coins: int
    active_cards_value: int  # estimated market value of unsold cards (before tax)
    unrealised_profit: int  # projected, after tax; never counted as realised
    total_portfolio_value: int
    extras: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["win_rate_pct"] = bp_to_pct(self.win_rate_bp)
        d["trading_roi_pct"] = bp_to_pct(self.trading_roi_bp)
        d["average_roi_pct"] = bp_to_pct(self.average_roi_bp)
        return d


# --------------------------------------------------------------------------- engine


class FC27MarketEngine:
    def __init__(self, config: EngineConfig | None = None):
        self.config = config or EngineConfig()

    # -- tax --------------------------------------------------------------------------

    def sale_breakdown(self, unit_price: int, quantity: int = 1) -> SaleBreakdown:
        if unit_price < 0 or quantity < 0:
            raise TradeValidationError("invalid_amount", "Price and quantity cannot be negative.")
        gross = unit_price * quantity
        tax = round_coins(Decimal(gross) * self.config.tax_rate_bp / BP)
        return SaleBreakdown(gross=gross, tax=tax, net=gross - tax)

    def net_after_tax(self, unit_price: int, quantity: int = 1) -> int:
        return self.sale_breakdown(unit_price, quantity).net

    def entry_threshold_price(self, historical_low: int) -> int:
        return floor_coins(Decimal(historical_low) * self.config.entry_threshold_bp / BP)

    # -- opportunity evaluation -------------------------------------------------------

    def evaluate_opportunity(
        self,
        player_name: str,
        current_price: int | None,
        historical_low: int | None,
        historical_high: int | None,
        *,
        price_history: Sequence[int] | None = None,
        expected_sell_price: int | None = None,
        observed_at: datetime | None = None,
        now: datetime | None = None,
        data_source: str | None = None,
        quantity: int = 1,
        existing_position_cost: int = 0,
        current_exposure: int | None = None,
    ) -> Opportunity:
        """Classify a buy-now price as BUY / HOLD / SELL / WATCH / RISK.

        BUY requires all three: the price is within the entry threshold of the historical
        low, estimated profit after tax >= min_profit, and estimated ROI >= min_roi.
        """
        cfg = self.config
        now = now or datetime.now(timezone.utc)
        reasons: list[str] = []
        checks: dict[str, bool | None] = {"entry": None, "profit": None, "roi": None, "fresh": None}

        age_hours: float | None = None
        is_stale = False
        if observed_at is not None:
            age = now - observed_at
            age_hours = round(age.total_seconds() / 3600, 2)
            is_stale = age > cfg.stale_after
            checks["fresh"] = not is_stale

        expected_sell = expected_sell_price or historical_high
        volatility = _volatility_bp(price_history)

        def result(signal: str, explanation: str, **extra) -> Opportunity:
            base = dict(
                player_name=player_name,
                signal=signal,
                current_price=current_price,
                historical_low=historical_low,
                historical_high=historical_high,
                entry_threshold_price=None,
                suggested_max_buy=None,
                expected_sell_price=expected_sell,
                expected_net_proceeds=None,
                estimated_profit=None,
                roi_bp=None,
                volatility_bp=volatility,
                data_source=data_source,
                observed_at=observed_at,
                data_age_hours=age_hours,
                is_stale=is_stale,
                checks=checks,
                reasons=reasons,
                explanation=explanation,
            )
            base.update(extra)
            return Opportunity(**base)

        # WATCH: not enough data to judge.
        missing = [
            label
            for label, value in (
                ("current buy-now price", current_price),
                ("historical low", historical_low),
                ("historical high", historical_high),
            )
            if value is None
        ]
        if missing:
            reasons.append("Missing " + ", ".join(missing) + ".")
            return result(SIGNAL_WATCH, "Not enough market data to evaluate. Add prices to continue.")
        if is_stale:
            reasons.append(
                f"Latest price is {age_hours:.1f}h old (limit {cfg.stale_after.total_seconds() / 3600:.0f}h)."
            )
            return result(SIGNAL_WATCH, "Market data is stale. Refresh or enter a current price before trading.")

        assert current_price is not None and historical_low is not None and historical_high is not None

        # RISK: the data itself looks unreliable.
        if current_price <= 0 or historical_low <= 0 or historical_high <= 0:
            reasons.append("Prices must be positive.")
            return result(SIGNAL_RISK, "Price data is invalid.")
        if historical_low > historical_high:
            reasons.append("Historical low is above historical high.")
            return result(SIGNAL_RISK, "Price history is inconsistent and cannot be trusted.")
        if current_price < historical_low // 2 or current_price > historical_high * 2:
            reasons.append("Current price is far outside the historical range.")
            return result(SIGNAL_RISK, "Current price is an outlier against history — possible bad data or a market shock.")
        if volatility is not None and volatility > cfg.max_volatility_bp:
            reasons.append(
                f"Price volatility {volatility / 100:.1f}% exceeds the {cfg.max_volatility_bp / 100:.1f}% limit."
            )
            return result(SIGNAL_RISK, "Recent prices are too volatile for a reliable estimate.")

        entry_price = self.entry_threshold_price(historical_low)
        net = self.net_after_tax(expected_sell)
        profit = net - current_price
        roi = ratio_bp(profit, current_price)
        suggested_max = min(
            entry_price,
            net - cfg.min_profit,
            floor_coins(Decimal(net) * BP / (BP + cfg.min_roi_bp)),
        )
        numbers = dict(
            entry_threshold_price=entry_price,
            suggested_max_buy=max(suggested_max, 0),
            expected_net_proceeds=net,
            estimated_profit=profit,
            roi_bp=roi,
        )

        # SELL: price has reached the target selling level.
        if current_price >= expected_sell:
            reasons.append(f"Current price {current_price:,} is at or above the target sell price {expected_sell:,}.")
            checks.update(entry=current_price * BP <= historical_low * cfg.entry_threshold_bp, profit=False, roi=False)
            return result(
                SIGNAL_SELL,
                "Target selling conditions reached. If you hold this card, consider listing it.",
                **numbers,
            )

        checks["entry"] = current_price * BP <= historical_low * cfg.entry_threshold_bp
        checks["profit"] = profit >= cfg.min_profit
        checks["roi"] = roi >= cfg.min_roi_bp

        reasons.append(
            f"Entry: {current_price:,} vs threshold {entry_price:,} "
            f"({cfg.entry_threshold_bp / 100:.0f}% of low {historical_low:,}) — {'pass' if checks['entry'] else 'fail'}."
        )
        reasons.append(
            f"Profit after {cfg.tax_rate_bp / 100:g}% tax: {profit:,} vs minimum {cfg.min_profit:,} — "
            f"{'pass' if checks['profit'] else 'fail'}."
        )
        reasons.append(
            f"ROI: {roi / 100:.2f}% vs minimum {cfg.min_roi_bp / 100:.2f}% — {'pass' if checks['roi'] else 'fail'}."
        )

        if not all((checks["entry"], checks["profit"], checks["roi"])):
            return result(SIGNAL_HOLD, "No sufficiently attractive entry at the current price.", **numbers)

        # RISK: criteria met, but buying would breach a configured limit.
        total = current_price * max(quantity, 1)
        if cfg.max_investment_per_card is not None and existing_position_cost + total > cfg.max_investment_per_card:
            reasons.append(
                f"Position would be {existing_position_cost + total:,} coins, above the per-card limit of "
                f"{cfg.max_investment_per_card:,}."
            )
            return result(SIGNAL_RISK, "Meets buy criteria but breaches your per-card investment limit.", **numbers)
        if (
            cfg.max_portfolio_exposure is not None
            and current_exposure is not None
            and current_exposure + total > cfg.max_portfolio_exposure
        ):
            reasons.append(
                f"Exposure would be {current_exposure + total:,} coins, above the portfolio limit of "
                f"{cfg.max_portfolio_exposure:,}."
            )
            return result(SIGNAL_RISK, "Meets buy criteria but breaches your portfolio exposure limit.", **numbers)

        return result(
            SIGNAL_BUY,
            f"BUY SIGNAL: within {cfg.entry_threshold_bp / 100 - 100:g}% of the historical low with an estimated "
            f"{profit:,} coin profit ({roi / 100:.2f}% ROI) after tax if it resells at {expected_sell:,}.",
            **numbers,
        )

    # -- purchase ---------------------------------------------------------------------

    def plan_purchase(
        self,
        unit_price: int,
        quantity: int,
        available_coins: int,
        invested_coins: int,
        *,
        existing_position_cost: int = 0,
    ) -> PurchasePlan:
        """Validate a purchase and compute the balances that result from it (execute_purchase rules)."""
        cfg = self.config
        if not isinstance(unit_price, int) or unit_price <= 0:
            raise TradeValidationError("invalid_price", "Purchase price must be a positive whole number of coins.")
        if not isinstance(quantity, int) or quantity <= 0:
            raise TradeValidationError("invalid_quantity", "Quantity must be a positive whole number.")
        if quantity > 100:
            raise TradeValidationError("invalid_quantity", "Quantity cannot exceed 100 cards in one purchase.")
        total = unit_price * quantity
        if total > available_coins:
            raise TradeValidationError(
                "insufficient_coins",
                f"Insufficient available coins: need {total:,}, have {available_coins:,}.",
            )
        if cfg.max_investment_per_card is not None and existing_position_cost + total > cfg.max_investment_per_card:
            raise TradeValidationError(
                "position_limit",
                f"This would put {existing_position_cost + total:,} coins into one card; your limit is "
                f"{cfg.max_investment_per_card:,}.",
            )
        if cfg.max_portfolio_exposure is not None and invested_coins + total > cfg.max_portfolio_exposure:
            raise TradeValidationError(
                "exposure_limit",
                f"Invested coins would reach {invested_coins + total:,}; your portfolio exposure limit is "
                f"{cfg.max_portfolio_exposure:,}.",
            )
        return PurchasePlan(
            unit_price=unit_price,
            quantity=quantity,
            total_cost=total,
            available_before=available_coins,
            available_after=available_coins - total,
            invested_before=invested_coins,
            invested_after=invested_coins + total,
        )

    # -- settlement -------------------------------------------------------------------

    def settle(self, purchase_price: int, quantity_remaining: int, quantity_sold: int, sale_price: int) -> Settlement:
        """Compute a (partial) sale (track_and_settle rules). Cost is allocated at the per-card purchase price."""
        if not isinstance(sale_price, int) or sale_price <= 0:
            raise TradeValidationError("invalid_price", "Sale price must be a positive whole number of coins.")
        if not isinstance(quantity_sold, int) or quantity_sold <= 0:
            raise TradeValidationError("invalid_quantity", "Quantity sold must be a positive whole number.")
        if quantity_remaining <= 0:
            raise TradeValidationError("already_settled", "This transfer has no remaining cards to sell.")
        if quantity_sold > quantity_remaining:
            raise TradeValidationError(
                "invalid_quantity",
                f"Cannot sell {quantity_sold} cards; only {quantity_remaining} remain on this transfer.",
            )
        sale = self.sale_breakdown(sale_price, quantity_sold)
        cost = purchase_price * quantity_sold
        profit = sale.net - cost
        return Settlement(
            quantity=quantity_sold,
            purchase_price=purchase_price,
            purchase_cost=cost,
            sale_price=sale_price,
            gross=sale.gross,
            tax=sale.tax,
            net=sale.net,
            realised_profit=profit,
            roi_bp=ratio_bp(profit, cost),
            quantity_remaining_after=quantity_remaining - quantity_sold,
        )

    # -- reporting --------------------------------------------------------------------

    def generate_performance_report(
        self,
        trades: Sequence[TradeRecord],
        *,
        available_coins: int,
        invested_coins: int,
        active_cards_value: int,
        unrealised_profit: int | None = None,
    ) -> PerformanceReport:
        """Summarise settled trades. Only realised trades count as profit; open cards are unrealised."""
        wins = [t for t in trades if t.realised_profit > 0]
        losses = [t for t in trades if t.realised_profit < 0]
        n = len(trades)
        gains = sum(t.realised_profit for t in wins)
        loss_total = -sum(t.realised_profit for t in losses)
        net = gains - loss_total
        cost_basis = sum(t.purchase_cost for t in trades)

        def brief(t: TradeRecord) -> dict:
            return {
                "id": t.id,
                "player_name": t.player_name,
                "quantity": t.quantity,
                "realised_profit": t.realised_profit,
                "roi_pct": bp_to_pct(t.roi_bp),
                "sold_at": t.sold_at.isoformat(),
            }

        holding = [(t.sold_at - t.purchased_at).total_seconds() / 3600 for t in trades]
        return PerformanceReport(
            total_trades=n,
            profitable_trades=len(wins),
            losing_trades=len(losses),
            breakeven_trades=n - len(wins) - len(losses),
            win_rate_bp=ratio_bp(len(wins), n),
            total_realised_profit=gains,
            total_realised_losses=loss_total,
            net_realised_profit=net,
            total_cost_basis=cost_basis,
            trading_roi_bp=ratio_bp(net, cost_basis),
            average_profit_per_trade=round_coins(Decimal(net) / n) if n else 0,
            average_roi_bp=round_coins(Decimal(sum(t.roi_bp for t in trades)) / n) if n else 0,
            best_trade=brief(max(trades, key=lambda t: t.realised_profit)) if trades else None,
            worst_trade=brief(min(trades, key=lambda t: t.realised_profit)) if trades else None,
            average_holding_hours=round(sum(holding) / n, 2) if n else None,
            available_coins=available_coins,
            invested_coins=invested_coins,
            active_cards_value=active_cards_value,
            unrealised_profit=(
                unrealised_profit if unrealised_profit is not None else active_cards_value - invested_coins
            ),
            total_portfolio_value=available_coins + active_cards_value,
        )


def _volatility_bp(history: Sequence[int] | None) -> int | None:
    """Coefficient of variation (stdev / mean) of a price series, in basis points."""
    if not history or len(history) < 3:
        return None
    values = [v for v in history if v and v > 0]
    if len(values) < 3:
        return None
    mean = sum(values) / len(values)
    var = sum((v - mean) ** 2 for v in values) / (len(values) - 1)
    return round(math.sqrt(var) / mean * BP)

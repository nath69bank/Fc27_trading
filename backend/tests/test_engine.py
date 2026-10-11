"""Unit tests for the pure trading engine."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.engine import (
    EngineConfig,
    FC27MarketEngine,
    TradeRecord,
    TradeValidationError,
)

NOW = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def engine():
    return FC27MarketEngine()


# ---------------------------------------------------------------- demo baseline (spec section 17)


def test_demo_scenario_generates_buy_signal(engine):
    opp = engine.evaluate_opportunity("Meta Gold Winger", 25_200, 25_000, 32_000, observed_at=NOW, now=NOW)
    assert opp.signal == "BUY"
    assert opp.entry_threshold_price == 25_500  # 25,000 x 1.02
    assert opp.expected_sell_price == 32_000
    assert opp.expected_net_proceeds == 30_400  # 32,000 x 0.95
    assert opp.estimated_profit == 5_200
    assert opp.roi_pct == 20.63
    assert opp.checks == {"entry": True, "profit": True, "roi": True, "fresh": True}
    assert "guarantee" in opp.disclaimer.lower()
    assert "guaranteed" not in opp.explanation.lower()


def test_demo_scenario_purchase_and_sale_balances(engine):
    plan = engine.plan_purchase(25_200, 1, 150_000, 0)
    assert plan.total_cost == 25_200
    assert plan.available_after == 124_800
    assert plan.invested_after == 25_200
    s = engine.settle(25_200, 1, 1, 32_000)
    assert (s.gross, s.tax, s.net, s.realised_profit, s.roi_bp) == (32_000, 1_600, 30_400, 5_200, 2063)
    assert plan.available_after + s.net == 155_200


# ---------------------------------------------------------------- tax


def test_tax_rounding_is_half_up_and_reconciles(engine):
    b = engine.sale_breakdown(1_010)  # 5% = 50.5 -> 51
    assert (b.gross, b.tax, b.net) == (1_010, 51, 959)
    b = engine.sale_breakdown(1_009)  # 50.45 -> 50
    assert b.tax == 50
    for price in range(150, 5_000, 37):
        b = engine.sale_breakdown(price, 3)
        assert b.gross == b.net + b.tax


def test_custom_tax_rate():
    e = FC27MarketEngine(EngineConfig(tax_rate_bp=1000))
    assert e.net_after_tax(10_000) == 9_000


def test_multi_card_tax_is_on_gross(engine):
    b = engine.sale_breakdown(15_500, 3)
    assert b.gross == 46_500
    assert b.tax == 2_325
    assert b.net == 44_175


# ---------------------------------------------------------------- signals


def test_hold_when_entry_above_threshold(engine):
    opp = engine.evaluate_opportunity("X", 26_000, 25_000, 32_000, observed_at=NOW, now=NOW)
    assert opp.signal == "HOLD"
    assert opp.checks["entry"] is False
    assert opp.estimated_profit == 4_400  # still computed for display


def test_hold_when_profit_below_minimum(engine):
    # Narrow range: entry ok, but 10,300 x 0.95 - 10,100 = -315
    opp = engine.evaluate_opportunity("X", 10_100, 10_000, 10_300, observed_at=NOW, now=NOW)
    assert opp.signal == "HOLD"
    assert opp.estimated_profit == -315
    assert opp.roi_bp < 0
    assert opp.checks["profit"] is False


def test_hold_when_roi_below_minimum():
    e = FC27MarketEngine(EngineConfig(min_roi_bp=2500))  # need 25%
    opp = e.evaluate_opportunity("X", 25_200, 25_000, 32_000, observed_at=NOW, now=NOW)
    assert opp.signal == "HOLD"
    assert opp.checks == {"entry": True, "profit": True, "roi": False, "fresh": True}
    # suggested max respects the ROI rule: 30,400 / 1.25 = 24,320
    assert opp.suggested_max_buy == 24_320


def test_sell_when_price_reaches_target(engine):
    opp = engine.evaluate_opportunity("X", 32_250, 25_000, 32_000, observed_at=NOW, now=NOW)
    assert opp.signal == "SELL"


def test_watch_when_data_missing(engine):
    assert engine.evaluate_opportunity("X", None, 25_000, 32_000).signal == "WATCH"
    assert engine.evaluate_opportunity("X", 25_000, None, None, observed_at=NOW, now=NOW).signal == "WATCH"


def test_watch_when_data_stale(engine):
    opp = engine.evaluate_opportunity("X", 25_200, 25_000, 32_000, observed_at=NOW - timedelta(hours=30), now=NOW)
    assert opp.signal == "WATCH"
    assert opp.is_stale is True
    assert opp.data_age_hours == 30


@pytest.mark.parametrize(
    "current,low,high",
    [(0, 25_000, 32_000), (25_200, 33_000, 32_000), (100_000, 25_000, 32_000), (-5, 1, 2)],
)
def test_risk_when_prices_invalid(engine, current, low, high):
    assert engine.evaluate_opportunity("X", current, low, high, observed_at=NOW, now=NOW).signal == "RISK"


def test_risk_when_history_volatile(engine):
    opp = engine.evaluate_opportunity(
        "X", 25_200, 25_000, 32_000, price_history=[25_000, 60_000, 12_000, 32_000, 25_200], observed_at=NOW, now=NOW
    )
    assert opp.signal == "RISK"


def test_risk_when_buy_breaches_limits():
    e = FC27MarketEngine(EngineConfig(max_investment_per_card=30_000, max_portfolio_exposure=100_000))
    assert e.evaluate_opportunity("X", 25_200, 25_000, 32_000, observed_at=NOW, now=NOW, quantity=2).signal == "RISK"
    assert (
        e.evaluate_opportunity("X", 25_200, 25_000, 32_000, observed_at=NOW, now=NOW, current_exposure=90_000).signal
        == "RISK"
    )
    assert e.evaluate_opportunity("X", 25_200, 25_000, 32_000, observed_at=NOW, now=NOW).signal == "BUY"


def test_configurable_thresholds():
    e = FC27MarketEngine(EngineConfig(entry_threshold_bp=10_500, min_profit=6_000))
    opp = e.evaluate_opportunity("X", 26_000, 25_000, 32_000, observed_at=NOW, now=NOW)
    assert opp.checks["entry"] is True  # 26,000 <= 26,250
    assert opp.signal == "HOLD"  # profit 4,400 < 6,000


def test_expected_sell_override(engine):
    opp = engine.evaluate_opportunity("X", 25_200, 25_000, 32_000, expected_sell_price=28_000, observed_at=NOW, now=NOW)
    assert opp.expected_net_proceeds == 26_600
    assert opp.estimated_profit == 1_400
    assert opp.signal == "BUY"


# ---------------------------------------------------------------- purchase validation


def test_insufficient_coins(engine):
    with pytest.raises(TradeValidationError) as exc:
        engine.plan_purchase(25_200, 6, 150_000, 0)  # 151,200 > 150,000
    assert exc.value.code == "insufficient_coins"


@pytest.mark.parametrize("price,qty,code", [(0, 1, "invalid_price"), (-1, 1, "invalid_price"), (100, 0, "invalid_quantity"), (100, 101, "invalid_quantity")])
def test_invalid_purchase_inputs(engine, price, qty, code):
    with pytest.raises(TradeValidationError) as exc:
        engine.plan_purchase(price, qty, 10**9, 0)
    assert exc.value.code == code


def test_position_and_exposure_limits():
    e = FC27MarketEngine(EngineConfig(max_investment_per_card=50_000, max_portfolio_exposure=60_000))
    with pytest.raises(TradeValidationError, match="one card"):
        e.plan_purchase(25_200, 1, 10**6, 0, existing_position_cost=30_000)
    with pytest.raises(TradeValidationError) as exc:
        e.plan_purchase(25_200, 1, 10**6, 40_000)
    assert exc.value.code == "exposure_limit"


# ---------------------------------------------------------------- settlement


def test_partial_settlement(engine):
    s = engine.settle(purchase_price=11_000, quantity_remaining=3, quantity_sold=2, sale_price=15_500)
    assert s.purchase_cost == 22_000
    assert s.gross == 31_000 and s.tax == 1_550 and s.net == 29_450
    assert s.realised_profit == 7_450
    assert s.quantity_remaining_after == 1


def test_losing_settlement(engine):
    s = engine.settle(25_200, 1, 1, 25_000)
    assert s.net == 23_750
    assert s.realised_profit == -1_450
    assert s.roi_bp == -575


def test_cannot_oversell_or_resettle(engine):
    with pytest.raises(TradeValidationError):
        engine.settle(1_000, 1, 2, 2_000)
    with pytest.raises(TradeValidationError) as exc:
        engine.settle(1_000, 0, 1, 2_000)
    assert exc.value.code == "already_settled"


# ---------------------------------------------------------------- reporting


def test_empty_performance_report(engine):
    r = engine.generate_performance_report([], available_coins=150_000, invested_coins=0, active_cards_value=0)
    d = r.to_dict()
    assert d["total_trades"] == 0
    assert d["win_rate_pct"] == 0
    assert d["average_profit_per_trade"] == 0
    assert d["best_trade"] is None and d["worst_trade"] is None
    assert d["average_holding_hours"] is None
    assert d["total_portfolio_value"] == 150_000


def test_performance_report_mixed(engine):
    t0 = NOW - timedelta(days=2)
    trades = [
        TradeRecord("A", 1, 25_200, 30_400, 5_200, 2063, t0, t0 + timedelta(hours=10), "a"),
        TradeRecord("B", 2, 22_000, 20_900, -1_100, -500, t0, t0 + timedelta(hours=20), "b"),
        TradeRecord("C", 1, 1_000, 1_000, 0, 0, t0, t0 + timedelta(hours=30), "c"),
    ]
    r = engine.generate_performance_report(trades, available_coins=100_000, invested_coins=20_000, active_cards_value=22_000)
    assert r.total_trades == 3
    assert (r.profitable_trades, r.losing_trades, r.breakeven_trades) == (1, 1, 1)
    assert r.win_rate_bp == 3333
    assert r.total_realised_profit == 5_200
    assert r.total_realised_losses == 1_100
    assert r.net_realised_profit == 4_100
    assert r.trading_roi_bp == round(4_100 / 48_200 * 10_000)
    assert r.average_profit_per_trade == 1_367
    assert r.best_trade["id"] == "a" and r.worst_trade["id"] == "b"
    assert r.average_holding_hours == 20
    assert r.unrealised_profit == 2_000  # never folded into realised figures
    assert r.total_portfolio_value == 122_000


# ---------------------------------------------------------------- break-even & flips (community examples)


@pytest.mark.parametrize("buy", [750, 2_200, 4_300, 6_000, 7_700, 9_200, 17_500, 25_200, 1_000_000])
def test_break_even_is_the_lowest_price_that_recovers_cost(engine, buy):
    be = engine.break_even_price(buy)
    assert engine.net_after_tax(be) >= buy
    assert engine.net_after_tax(be - 1) < buy


def test_snipe_below_market_can_still_lose_after_tax(engine):
    # Snipe at 7,700, relist at the 8,000 market: tax makes it a loss.
    f = engine.flip(7_700, 8_000)
    assert (f["net"], f["profit"]) == (7_600, -100)
    # To clear 500 profit at an 8,000 resale you must pay no more than 7,100.
    assert engine.flip(7_700, 8_000, target_profit=500)["max_buy_for_target"] == 7_100


def test_rated_fodder_needs_a_real_spike(engine):
    f = engine.flip(9_200, 10_000, quantity=3, target_profit=1_000)
    assert f["break_even_sell"] == 9_684 and f["required_rise_pct"] == 5.26
    assert f["profit"] == 900 and f["sell_for_target"] == 10_737


def test_cheap_spec_gain_mostly_eaten_by_tax(engine):
    f = engine.flip(750, 850, quantity=5)
    assert f["profit_per_card"] == 57 and f["break_even_sell"] == 789


def test_trend_warnings_inform_without_changing_signal(engine):
    falling = engine.evaluate_opportunity("X", 25_200, 25_000, 32_000, observed_at=NOW, now=NOW, trend_24h_bp=-5_000)
    assert falling.signal == "BUY" and any("down 50.0% in 24h" in r for r in falling.reasons)
    spiking = engine.evaluate_opportunity("X", 25_200, 25_000, 32_000, observed_at=NOW, now=NOW, trend_24h_bp=2_000)
    assert any("up 20.0% in 24h" in r for r in spiking.reasons)
    assert falling.break_even_sell == 26_526 and falling.to_dict()["trend_24h_pct"] == -50.0

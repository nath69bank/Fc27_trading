"""generate_performance_report() and the dashboard summary. Everything is computed from
stored ledger rows, transfers and balance events — no hardcoded figures."""

from __future__ import annotations

from collections import defaultdict
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..engine import TradeRecord
from ..models import AccountBalance, BalanceEvent, TradeLedgerEntry, Transfer, User, WatchlistItem
from .accounts import balance_view
from .alerts import list_alerts, refresh_alerts
from .common import engine_for, get_settings_row, iso
from .market_data import data_status
from .scanner import OPEN_STATUSES, recent_signals, scan_watchlist
from .trading import current_estimate, ledger_view, refresh_statuses, transfer_view

ROI_BUCKETS = [(-10**9, -20, "< -20%"), (-20, -10, "-20 to -10%"), (-10, 0, "-10 to 0%"), (0, 10, "0 to 10%"),
               (10, 20, "10 to 20%"), (20, 30, "20 to 30%"), (30, 10**9, "> 30%")]


def open_positions_value(db: Session, user: User) -> tuple[int, int, int]:
    """(estimated market value, cost, projected after-tax profit) of unsold cards."""
    settings = get_settings_row(db, user)
    engine = engine_for(settings, with_limits=False)
    value = cost = unrealised = 0
    for t in db.scalars(select(Transfer).where(Transfer.user_id == user.id, Transfer.status.in_(OPEN_STATUSES))).all():
        price, _ = current_estimate(db, user, t)
        value += price * t.quantity_remaining
        cost += t.remaining_cost
        unrealised += engine.net_after_tax(price, t.quantity_remaining) - t.remaining_cost
    return value, cost, unrealised


def generate_performance_report(db: Session, user: User) -> dict:
    settings = get_settings_row(db, user)
    entries = db.scalars(
        select(TradeLedgerEntry).where(TradeLedgerEntry.user_id == user.id).order_by(TradeLedgerEntry.sold_at.asc())
    ).all()
    trades = [
        TradeRecord(
            id=e.id, player_name=e.player_name, quantity=e.quantity, purchase_cost=e.purchase_cost,
            net_proceeds=e.net_proceeds, realised_profit=e.realised_profit, roi_bp=e.roi_bp,
            purchased_at=e.purchased_at, sold_at=e.sold_at,
        )
        for e in entries
    ]
    balance = db.get(AccountBalance, user.id)
    value, _cost, unrealised = open_positions_value(db, user)
    report = engine_for(settings, with_limits=False).generate_performance_report(
        trades,
        available_coins=balance.available_coins,
        invested_coins=balance.invested_coins,
        active_cards_value=value,
        unrealised_profit=unrealised,
    ).to_dict()

    cumulative, running = [], 0
    daily: dict[str, int] = defaultdict(int)
    weekly: dict[str, int] = defaultdict(int)
    by_player: dict[str, dict] = defaultdict(lambda: {"profit": 0, "trades": 0})
    buckets = {label: 0 for *_r, label in ROI_BUCKETS}
    for e in entries:
        running += e.realised_profit
        cumulative.append({"t": iso(e.sold_at), "profit": e.realised_profit, "cumulative": running, "player_name": e.player_name})
        d = e.sold_at.date()
        daily[d.isoformat()] += e.realised_profit
        weekly[(d - timedelta(days=d.weekday())).isoformat()] += e.realised_profit
        by_player[e.player_name]["profit"] += e.realised_profit
        by_player[e.player_name]["trades"] += 1
        roi = e.roi_bp / 100
        for lo, hi, label in ROI_BUCKETS:
            if lo <= roi < hi:
                buckets[label] += 1
                break

    events = db.scalars(
        select(BalanceEvent).where(BalanceEvent.user_id == user.id).order_by(BalanceEvent.created_at.asc(), BalanceEvent.id)
    ).all()
    report["charts"] = {
        "cumulative_profit": cumulative,
        "daily_profit": [{"period": k, "profit": v} for k, v in sorted(daily.items())],
        "weekly_profit": [{"period": k, "profit": v} for k, v in sorted(weekly.items())],
        "profit_by_player": sorted(
            ({"player_name": k, **v} for k, v in by_player.items()), key=lambda r: r["profit"], reverse=True
        ),
        "roi_distribution": [{"bucket": k, "count": v} for k, v in buckets.items()],
        "wins_vs_losses": [
            {"outcome": "Winning", "count": report["profitable_trades"]},
            {"outcome": "Losing", "count": report["losing_trades"]},
            {"outcome": "Break-even", "count": report["breakeven_trades"]},
        ],
        # Account value at cost (available + invested) after every balance change.
        "portfolio_value": [
            {"t": iso(ev.created_at), "value": ev.available_after + ev.invested_after, "kind": ev.kind} for ev in events
        ],
    }
    report["starting_coins"] = settings.starting_coins
    report["has_simulated_trades"] = any(e.mode == "simulation" for e in entries)
    return report


def dashboard(db: Session, user: User) -> dict:
    refresh_statuses(db, user)
    refresh_alerts(db, user)
    report = generate_performance_report(db, user)
    opportunities = scan_watchlist(db, user, record=False)
    open_transfers = [
        transfer_view(db, user, t)
        for t in db.scalars(select(Transfer).where(Transfer.user_id == user.id, Transfer.status.in_(OPEN_STATUSES))).all()
    ]
    approaching = sorted(
        (t for t in open_transfers if (t["progress_to_target_pct"] or 0) >= 90),
        key=lambda t: t["progress_to_target_pct"] or 0,
        reverse=True,
    )
    recent = db.scalars(
        select(TradeLedgerEntry).where(TradeLedgerEntry.user_id == user.id).order_by(TradeLedgerEntry.sold_at.desc()).limit(5)
    ).all()
    has_watch = db.scalar(select(WatchlistItem.id).where(WatchlistItem.user_id == user.id).limit(1)) is not None
    signals = recent_signals(db, user, limit=8)
    return {
        "user": {"username": user.username, "is_demo": user.is_demo},
        "balance": balance_view(db, user),
        "metrics": {
            "available_coins": report["available_coins"],
            "invested_coins": report["invested_coins"],
            "portfolio_value": report["active_cards_value"],
            "total_account_value": report["total_portfolio_value"],
            "unrealised_profit": report["unrealised_profit"],
            "total_realised_profit": report["net_realised_profit"],
            "open_transfers": len(open_transfers),
            "trading_roi_pct": report["trading_roi_pct"],
            "completed_trades": report["total_trades"],
        },
        "data_status": data_status(db, user),
        "recent_signals": signals,
        "opportunities": [o for o in opportunities if o["signal"] in ("BUY", "SELL")][:6],
        "approaching_target": approaching[:5],
        "recent_trades": [ledger_view(e) for e in recent],
        "pnl_chart": report["charts"]["cumulative_profit"],
        "alerts": list_alerts(db, user, unread_only=True, limit=6),
        "walkthrough": {
            "watchlist": has_watch,
            "evaluated": bool(signals),
            "purchased": db.scalar(select(Transfer.id).where(Transfer.user_id == user.id).limit(1)) is not None,
            "sold": report["total_trades"] > 0,
        },
    }

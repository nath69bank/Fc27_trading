"""Rated fodder: the cheapest gold card at each rating, which SBCs consume in bulk.

Traders buy these floors before big SBCs or promos ("catalysts") and sell into the demand
spike. Each rating is tracked as an ordinary card ("Cheapest 88-rated gold"), so its
prices, history, staleness, alerts and trades all reuse the normal machinery."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Card, User
from .common import ServiceError, engine_for, get_settings_row
from .market_data import card_key, card_view, get_or_create_card, price_view, record_price, stats_for

RATINGS = tuple(range(82, 92))
VERSION = "Rated fodder"


def fodder_name(rating: int) -> str:
    return f"Cheapest {rating}-rated gold"


def _check_rating(rating: int) -> None:
    if rating not in RATINGS:
        raise ServiceError(422, "invalid_rating", f"Fodder ratings run from {RATINGS[0]} to {RATINGS[-1]}.")


def record_floor(db: Session, user: User, rating: int, price: int, *, seen_on: str | None = None,
                 observed_at: datetime | None = None) -> dict:
    _check_rating(rating)
    card = get_or_create_card(db, user, fodder_name(rating), version=VERSION, rating=rating)
    obs = record_price(db, user, card, price, source="manual", seen_on=seen_on, observed_at=observed_at)
    db.commit()
    return price_view(obs)


def fodder_board(db: Session, user: User, *, uplift_pct: float = 10.0, budget: int | None = None) -> dict:
    """Every rating's floor with the after-tax maths of selling into a demand spike."""
    if not 0 <= uplift_pct <= 500:
        raise ServiceError(422, "invalid_uplift", "Expected rise must be between 0% and 500%.")
    if budget is not None and budget <= 0:
        raise ServiceError(422, "invalid_amount", "Budget must be positive.")
    engine = engine_for(get_settings_row(db, user), with_limits=False)
    keys = {card_key(fodder_name(r), VERSION, r): r for r in RATINGS}
    cards = {keys[c.card_key]: c for c in db.scalars(select(Card).where(Card.user_id == user.id, Card.card_key.in_(keys))).all()}
    rows = []
    for r in RATINGS:
        card = cards.get(r)
        stats = stats_for(db, user, card) if card else None
        floor = stats.latest_price if stats else None
        row = {
            "rating": r,
            "name": fodder_name(r),
            "card": card_view(card) if card else None,
            "stats": stats.to_dict() if stats else None,
            "floor": floor,
        }
        if floor:
            sell = round(floor * (1 + uplift_pct / 100))
            per_card = engine.flip(floor, sell)
            row.update(
                break_even_sell=per_card["break_even_sell"],
                required_rise_pct=per_card["required_rise_pct"],
                sell_at_uplift=sell,
                profit_per_card=per_card["profit"],
                roi_pct=per_card["roi_pct"],
            )
            if budget:
                qty = budget // floor
                row["budget_qty"] = qty
                row["budget_profit"] = engine.flip(floor, sell, qty)["profit"] if qty else 0
        rows.append(row)
    return {"uplift_pct": uplift_pct, "budget": budget, "tax_rate_pct": engine.config.tax_rate_bp / 100, "ratings": rows}

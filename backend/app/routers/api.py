"""REST API. Every route except auth requires a bearer token, and every query is scoped to
the signed-in user."""

from __future__ import annotations

import csv
import io
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import schemas
from ..config import get_settings
from ..deps import bearer_token, current_user, get_db
from ..models import User
from ..security import create_session, revoke_session, verify_password
from ..seed import create_demo_account
from ..services import accounts, alerts, market_data, reports, scanner, trading, watchlist
from ..services.common import ServiceError, get_settings_row

router = APIRouter(prefix="/api")
Auth = Depends(current_user)
DB = Depends(get_db)


def _me(user: User) -> dict:
    return {"id": user.id, "username": user.username, "is_demo": user.is_demo}


# --------------------------------------------------------------------------- auth


@router.get("/health")
def health() -> dict:
    return {"ok": True}


@router.get("/auth/options")
def auth_options() -> dict:
    s = get_settings()
    return {"registration": s.allow_registration, "demo_signup": s.allow_demo_signup}


@router.post("/auth/register", status_code=201)
def register(body: schemas.Credentials, db: Session = DB) -> dict:
    if not get_settings().allow_registration:
        raise ServiceError(403, "registration_closed", "Registration is disabled on this server.")
    user = accounts.create_user(db, body.username, body.password)
    return {"token": create_session(db, user), "user": _me(user)}


@router.post("/auth/login")
def login(body: schemas.Credentials, db: Session = DB) -> dict:
    from sqlalchemy import func, select

    user = db.scalar(select(User).where(func.lower(User.username) == body.username.lower()))
    if user is None or not verify_password(body.password, user.password_hash):
        raise ServiceError(401, "invalid_credentials", "Incorrect username or password.")
    return {"token": create_session(db, user), "user": _me(user)}


@router.post("/auth/demo", status_code=201)
def demo_signup(db: Session = DB) -> dict:
    """Create a private, freshly seeded demo account so visitors never share state."""
    if not get_settings().allow_demo_signup:
        raise ServiceError(403, "demo_disabled", "Demo accounts are disabled on this server.")
    user, _ = create_demo_account(db)
    return {"token": create_session(db, user), "user": _me(user)}


@router.post("/auth/logout", status_code=204)
def logout(token: str = Depends(bearer_token), db: Session = DB) -> Response:
    revoke_session(db, token)
    return Response(status_code=204)


@router.get("/auth/me")
def me(user: User = Auth) -> dict:
    return _me(user)


# --------------------------------------------------------------------------- dashboard


@router.get("/dashboard")
def get_dashboard(user: User = Auth, db: Session = DB) -> dict:
    return reports.dashboard(db, user)


# --------------------------------------------------------------------------- watchlist


@router.get("/watchlist")
def list_watchlist(
    q: str | None = None,
    favourites: bool = False,
    sort: Literal["name", "price", "roi", "profit", "added"] = "added",
    order: Literal["asc", "desc"] = "desc",
    user: User = Auth,
    db: Session = DB,
) -> list[dict]:
    return watchlist.list_items(db, user, q=q, favourites=favourites, sort=sort, desc=order == "desc")


@router.post("/watchlist", status_code=201)
def create_watchlist_item(body: schemas.WatchlistCreate, user: User = Auth, db: Session = DB) -> dict:
    item = watchlist.add_to_watchlist(db, user, **body.model_dump())
    return watchlist.item_view(db, user, item)


@router.get("/watchlist/{item_id}")
def get_watchlist_item(item_id: str, user: User = Auth, db: Session = DB) -> dict:
    return watchlist.item_detail(db, user, item_id)


@router.patch("/watchlist/{item_id}")
def patch_watchlist_item(item_id: str, body: schemas.WatchlistUpdate, user: User = Auth, db: Session = DB) -> dict:
    return watchlist.update_item(db, user, item_id, body.model_dump(exclude_unset=True))


@router.delete("/watchlist/{item_id}", status_code=204)
def delete_watchlist_item(item_id: str, user: User = Auth, db: Session = DB) -> Response:
    watchlist.remove_item(db, user, item_id)
    return Response(status_code=204)


@router.post("/watchlist/{item_id}/evaluate")
def evaluate_watchlist_item(item_id: str, quantity: int = Query(1, ge=1, le=100), user: User = Auth, db: Session = DB) -> dict:
    result = scanner.evaluate_watchlist_item(db, user, item_id, quantity=quantity)
    alerts.refresh_alerts(db, user)
    return result


# --------------------------------------------------------------------------- scanner


@router.post("/scanner/evaluate")
def scanner_evaluate(body: schemas.ManualEvaluation, user: User = Auth, db: Session = DB) -> dict:
    return scanner.evaluate_manual(db, user, body.model_dump())


@router.post("/scanner/scan")
def scanner_scan(user: User = Auth, db: Session = DB) -> list[dict]:
    results = scanner.scan_watchlist(db, user, record=True)
    alerts.refresh_alerts(db, user)
    return results


@router.get("/scanner/signals")
def scanner_signals(
    signal: str | None = None, limit: int = Query(50, ge=1, le=500), user: User = Auth, db: Session = DB
) -> list[dict]:
    return scanner.recent_signals(db, user, limit=limit, signal=signal)


# --------------------------------------------------------------------------- market data


@router.get("/market/status")
def market_status(user: User = Auth, db: Session = DB) -> dict:
    return market_data.data_status(db, user)


@router.get("/market/cards")
def market_cards(user: User = Auth, db: Session = DB) -> list[dict]:
    from sqlalchemy import select

    from ..models import Card

    cards = db.scalars(select(Card).where(Card.user_id == user.id).order_by(Card.player_name)).all()
    return [{**market_data.card_view(c), "stats": market_data.stats_for(db, user, c).to_dict()} for c in cards]


@router.get("/market/prices")
def market_prices(card_id: str, limit: int = Query(500, ge=1, le=5000), user: User = Auth, db: Session = DB) -> list[dict]:
    return market_data.list_prices(db, user, card_id, limit=limit)


@router.post("/market/prices", status_code=201)
def add_price(body: schemas.PriceCreate, user: User = Auth, db: Session = DB) -> dict:
    if body.card_id:
        card = market_data.get_card(db, user, body.card_id)
    elif body.player_name:
        card = market_data.get_or_create_card(db, user, body.player_name)
    else:
        raise ServiceError(422, "card_required", "Choose a card or enter a player name.")
    obs = market_data.record_price(db, user, card, body.price, source="manual", observed_at=body.observed_at, platform=body.platform)
    db.commit()
    trading.refresh_statuses(db, user)
    alerts.refresh_alerts(db, user)
    return market_data.price_view(obs)


@router.delete("/market/prices/{price_id}", status_code=204)
def delete_price(price_id: str, user: User = Auth, db: Session = DB) -> Response:
    market_data.delete_price(db, user, price_id)
    return Response(status_code=204)


@router.post("/market/import")
def import_prices(body: schemas.CsvImport, user: User = Auth, db: Session = DB) -> dict:
    result = market_data.import_csv(db, user, body.csv)
    trading.refresh_statuses(db, user)
    alerts.refresh_alerts(db, user)
    return result


@router.post("/market/simulate")
def simulate(user: User = Auth, db: Session = DB) -> dict:
    result = market_data.simulate_market_move(db, user)
    trading.refresh_statuses(db, user)
    alerts.refresh_alerts(db, user)
    return result


@router.post("/market/refresh")
def refresh_live(user: User = Auth, db: Session = DB) -> dict:
    result = market_data.refresh_live(db, user)
    trading.refresh_statuses(db, user)
    alerts.refresh_alerts(db, user)
    return result


# --------------------------------------------------------------------------- transfers


@router.get("/transfers")
def get_transfers(status: str | None = None, q: str | None = None, user: User = Auth, db: Session = DB) -> list[dict]:
    trading.refresh_statuses(db, user)
    return trading.list_transfers(db, user, status=status, q=q)


@router.post("/transfers/preview")
def preview(body: schemas.PurchasePreview, user: User = Auth, db: Session = DB) -> dict:
    return trading.preview_purchase(db, user, unit_price=body.unit_price, quantity=body.quantity, card_id=body.card_id)


@router.post("/transfers")
def purchase(body: schemas.PurchaseCreate, response: Response, user: User = Auth, db: Session = DB) -> dict:
    view, created = trading.execute_purchase(db, user, **body.model_dump())
    response.status_code = 201 if created else 200
    if created:
        alerts.refresh_alerts(db, user)
    return {**view, "replayed": not created}


@router.get("/transfers/{transfer_id}")
def get_transfer(transfer_id: str, user: User = Auth, db: Session = DB) -> dict:
    return trading.transfer_view(db, user, trading.get_transfer(db, user, transfer_id))


@router.patch("/transfers/{transfer_id}")
def patch_transfer(transfer_id: str, body: schemas.TransferUpdate, user: User = Auth, db: Session = DB) -> dict:
    data = body.model_dump(exclude_unset=True)
    if data.pop("clear_estimate", False):
        data["estimated_price"] = None
    return trading.update_transfer(db, user, transfer_id, data)


@router.post("/transfers/{transfer_id}/sell")
def sell(transfer_id: str, body: schemas.SaleCreate, response: Response, user: User = Auth, db: Session = DB) -> dict:
    view, created = trading.track_and_settle(db, user, transfer_id, **body.model_dump())
    response.status_code = 201 if created else 200
    return {**view, "replayed": not created}


@router.post("/transfers/{transfer_id}/cancel")
def cancel(transfer_id: str, body: schemas.CancelRequest, user: User = Auth, db: Session = DB) -> dict:
    return trading.cancel_transfer(db, user, transfer_id, reason=body.reason)


# --------------------------------------------------------------------------- ledger & reports


@router.get("/ledger")
def get_ledger(
    q: str | None = None,
    outcome: Literal["win", "loss"] | None = None,
    sort: Literal["sold_at", "profit", "roi", "player", "net"] = "sold_at",
    order: Literal["asc", "desc"] = "desc",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    user: User = Auth,
    db: Session = DB,
) -> dict:
    return trading.list_ledger(db, user, q=q, outcome=outcome, sort=sort, desc=order == "desc", page=page, page_size=page_size)


@router.get("/ledger/export.csv")
def export_ledger(user: User = Auth, db: Session = DB) -> StreamingResponse:
    data = trading.list_ledger(db, user, page_size=200, page=1)
    rows = list(data["items"])
    page = 2
    while len(rows) < data["total"]:
        rows += trading.list_ledger(db, user, page_size=200, page=page)["items"]
        page += 1
    buf = io.StringIO()
    cols = ["id", "transfer_id", "player_name", "mode", "quantity", "purchase_price", "purchase_cost", "sale_price",
            "gross_proceeds", "tax", "net_proceeds", "realised_profit", "roi_pct", "purchased_at", "sold_at", "status"]
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    w.writerows(rows)
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=fc27-trade-ledger.csv"},
    )


@router.get("/reports/performance")
def performance(user: User = Auth, db: Session = DB) -> dict:
    return reports.generate_performance_report(db, user)


# --------------------------------------------------------------------------- alerts


@router.get("/alerts")
def get_alerts(unread: bool = False, type: str | None = None, user: User = Auth, db: Session = DB) -> dict:
    alerts.refresh_alerts(db, user)
    return alerts.list_alerts(db, user, unread_only=unread, type=type)


@router.post("/alerts/read-all", status_code=204)
def read_all(user: User = Auth, db: Session = DB) -> Response:
    alerts.mark_read(db, user)
    return Response(status_code=204)


@router.post("/alerts/{alert_id}/read", status_code=204)
def read_one(alert_id: str, user: User = Auth, db: Session = DB) -> Response:
    alerts.mark_read(db, user, alert_id)
    return Response(status_code=204)


# --------------------------------------------------------------------------- settings & account


@router.get("/settings")
def get_user_settings(user: User = Auth, db: Session = DB) -> dict:
    return accounts.settings_view(get_settings_row(db, user))


@router.put("/settings")
def put_user_settings(body: schemas.SettingsUpdate, user: User = Auth, db: Session = DB) -> dict:
    return accounts.update_settings(db, user, body.model_dump(exclude_unset=True))


@router.get("/account/balance")
def get_balance(user: User = Auth, db: Session = DB) -> dict:
    return accounts.balance_view(db, user)


@router.get("/account/events")
def get_events(kind: str | None = None, limit: int = Query(100, ge=1, le=1000), user: User = Auth, db: Session = DB) -> list[dict]:
    return accounts.list_events(db, user, kind=kind, limit=limit)


@router.post("/account/adjustments", status_code=201)
def post_adjustment(body: schemas.BalanceAdjustment, user: User = Auth, db: Session = DB) -> dict:
    return accounts.adjust_balance(db, user, body.amount, body.reason)


@router.get("/account/reconcile")
def get_reconcile(user: User = Auth, db: Session = DB) -> dict:
    return accounts.reconcile(db, user)


@router.get("/meta")
def meta(request: Request) -> dict:
    return {"app": "FC 27 Market Engine", "tagline": "Trade Smarter. Track Every Coin.", "version": request.app.version}

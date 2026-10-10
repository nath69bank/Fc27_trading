"""End-to-end tests through the REST API against a real (SQLite) database."""

from __future__ import annotations

from datetime import timedelta

from fastapi.testclient import TestClient

from app.db import utcnow
from app.main import create_app

from .conftest import add_card_with_prices, balance, buy, demo, key, sell, signup


def _watch(client, h, name):
    return next(w for w in client.get("/api/watchlist", headers=h).json() if w["card"]["player_name"] == name)


def test_demo_end_to_end_flow(client, demo_user):
    h = demo_user
    assert balance(client, h)["available_coins"] == 150_000

    item = _watch(client, h, "Meta Gold Winger")
    assert (item["target_buy"], item["target_sell"]) == (25_000, 32_000)
    assert item["latest_source"] == "sample"  # demo data is labelled, never "live"
    assert (item["historical_low"], item["historical_high"], item["latest_price"]) == (25_000, 32_000, 25_200)

    opp = client.post(f"/api/watchlist/{item['id']}/evaluate", headers=h).json()
    assert opp["signal"] == "BUY"
    assert (opp["expected_net_proceeds"], opp["estimated_profit"], opp["roi_pct"]) == (30_400, 5_200, 20.63)
    assert opp["is_simulated"] is True

    r = buy(client, h, item["card"]["id"], 25_200, target=32_000)
    assert r.status_code == 201
    transfer = r.json()
    assert balance(client, h)["available_coins"] == 124_800
    assert balance(client, h)["invested_coins"] == 25_200

    r = sell(client, h, transfer["id"], 32_000)
    assert r.status_code == 201
    entry = r.json()
    assert (entry["net_proceeds"], entry["tax"], entry["realised_profit"], entry["roi_pct"]) == (30_400, 1_600, 5_200, 20.63)
    assert balance(client, h) | {"updated_at": None} == {"available_coins": 155_200, "invested_coins": 0, "updated_at": None}

    report = client.get("/api/reports/performance", headers=h).json()
    assert report["total_trades"] == 1
    assert report["net_realised_profit"] == 5_200
    assert report["win_rate_pct"] == 100
    assert report["charts"]["cumulative_profit"][-1]["cumulative"] == 5_200

    dash = client.get("/api/dashboard", headers=h).json()
    assert dash["metrics"]["total_realised_profit"] == 5_200
    assert dash["metrics"]["available_coins"] == 155_200
    assert dash["walkthrough"] == {"watchlist": True, "evaluated": True, "purchased": True, "sold": True}
    assert client.get("/api/account/reconcile", headers=h).json()["balanced"] is True


def test_insufficient_coins_rejected_without_side_effects(client, user):
    item = add_card_with_prices(client, user)
    r = buy(client, user, item["card"]["id"], 100_000, qty=2, target=150_000)
    assert r.status_code == 422
    assert r.json()["detail"]["code"] in ("insufficient_coins", "position_limit", "exposure_limit")
    r = buy(client, user, item["card"]["id"], 151_000, target=200_000)
    assert r.json()["detail"]["code"] in ("insufficient_coins", "position_limit", "exposure_limit")
    assert balance(client, user)["available_coins"] == 150_000
    assert client.get("/api/transfers", headers=user).json() == []


def test_insufficient_coins_code(client, user):
    client.put("/api/settings", headers=user, json={"max_investment_per_card": 10**9, "max_portfolio_exposure": 10**9})
    item = add_card_with_prices(client, user)
    r = buy(client, user, item["card"]["id"], 50_000, qty=4, target=60_000)
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "insufficient_coins"


def test_invalid_inputs_rejected(client, user):
    item = add_card_with_prices(client, user)
    cid = item["card"]["id"]
    assert buy(client, user, cid, 0).status_code == 422
    assert buy(client, user, cid, -100).status_code == 422
    assert buy(client, user, cid, 1000, qty=0).status_code == 422
    r = client.post("/api/transfers", headers=user, json={"idempotency_key": key(), "card_id": cid, "unit_price": 1000, "quantity": 1, "target_sell_price": 2000, "realised_profit": 99999})
    assert r.status_code == 422  # client-computed values are refused outright
    assert client.post("/api/market/prices", headers=user, json={"card_id": cid, "price": -5}).status_code == 422
    assert client.post("/api/watchlist", headers=user, json={"player_name": "Bad", "target_buy": 5000, "target_sell": 4000}).status_code == 422


def test_multiple_cards_same_name_have_unique_transfers(client, user):
    item = add_card_with_prices(client, user, name="Twin")
    a = buy(client, user, item["card"]["id"], 10_000, target=14_000).json()
    b = buy(client, user, item["card"]["id"], 10_200, target=14_000).json()
    assert a["id"] != b["id"]
    assert a["player_name"] == b["player_name"] == "Twin"
    sell(client, user, b["id"], 13_000)
    transfers = {t["id"]: t for t in client.get("/api/transfers", headers=user).json()}
    assert transfers[a["id"]]["status"] in ("active", "target_reached")
    assert transfers[b["id"]]["status"] == "sold"
    assert balance(client, user)["invested_coins"] == 10_000


def test_partial_sales_keep_remaining_cost(client, user):
    item = add_card_with_prices(client, user, name="Fodder", target_buy=11_000, target_sell=15_500, prices=(11_000, 13_000, 15_500, 11_000))
    t = buy(client, user, item["card"]["id"], 11_000, qty=3, target=15_500).json()
    assert balance(client, user)["invested_coins"] == 33_000

    e = sell(client, user, t["id"], 15_500, qty=2).json()
    assert (e["quantity"], e["purchase_cost"], e["net_proceeds"], e["realised_profit"]) == (2, 22_000, 29_450, 7_450)
    t2 = client.get(f"/api/transfers/{t['id']}", headers=user).json()
    assert t2["quantity_remaining"] == 1
    assert t2["total_invested"] == 11_000
    assert t2["status"] != "sold"
    assert balance(client, user)["invested_coins"] == 11_000
    assert balance(client, user)["available_coins"] == 150_000 - 33_000 + 29_450

    assert sell(client, user, t["id"], 15_500, qty=2).status_code == 422  # only one left
    e2 = sell(client, user, t["id"], 14_000, qty=1).json()
    assert e2["realised_profit"] == 13_300 - 11_000
    t3 = client.get(f"/api/transfers/{t['id']}", headers=user).json()
    assert t3["status"] == "sold" and t3["quantity_remaining"] == 0
    assert len(t3["sales"]) == 2
    assert client.get("/api/account/reconcile", headers=user).json()["balanced"] is True


def test_duplicate_settlement_prevented(client, user):
    item = add_card_with_prices(client, user)
    t = buy(client, user, item["card"]["id"], 10_000).json()
    k = key()
    first = sell(client, user, t["id"], 14_000, k=k)
    assert first.status_code == 201
    after_first = balance(client, user)

    replay = sell(client, user, t["id"], 14_000, k=k)  # double click / retry
    assert replay.status_code == 200
    assert replay.json()["replayed"] is True
    assert replay.json()["id"] == first.json()["id"]

    again = sell(client, user, t["id"], 14_000)  # new request on a sold transfer
    assert again.status_code == 409
    assert again.json()["detail"]["code"] == "already_settled"

    misuse = sell(client, user, t["id"], 15_000, k=k)  # same id, different sale
    assert misuse.status_code == 409

    assert balance(client, user)["available_coins"] == after_first["available_coins"]
    assert client.get("/api/ledger", headers=user).json()["total"] == 1


def test_duplicate_purchase_prevented(client, user):
    item = add_card_with_prices(client, user)
    k = key()
    a = buy(client, user, item["card"]["id"], 10_000, k=k)
    b = buy(client, user, item["card"]["id"], 10_000, k=k)
    assert a.status_code == 201 and b.status_code == 200
    assert a.json()["id"] == b.json()["id"]
    assert balance(client, user)["available_coins"] == 140_000


def test_cancel_refunds_and_cannot_be_settled(client, user):
    item = add_card_with_prices(client, user)
    t = buy(client, user, item["card"]["id"], 10_000, qty=2).json()
    r = client.post(f"/api/transfers/{t['id']}/cancel", headers=user, json={"reason": "test"})
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert balance(client, user)["available_coins"] == 150_000
    assert balance(client, user)["invested_coins"] == 0
    assert sell(client, user, t["id"], 12_000).status_code == 409
    assert client.post(f"/api/transfers/{t['id']}/cancel", headers=user, json={}).status_code == 409


def test_balance_reconciliation_after_many_operations(client, user):
    client.put("/api/settings", headers=user, json={"max_investment_per_card": 10**9, "max_portfolio_exposure": 10**9})
    item = add_card_with_prices(client, user)
    cid = item["card"]["id"]
    ts = [buy(client, user, cid, 9_000 + i * 250, qty=1 + i % 3).json() for i in range(6)]
    sell(client, user, ts[0]["id"], 12_000, qty=1)
    sell(client, user, ts[1]["id"], 8_000, qty=1)  # a loss
    sell(client, user, ts[2]["id"], 13_000, qty=2)
    client.post(f"/api/transfers/{ts[3]['id']}/cancel", headers=user, json={})
    client.post("/api/account/adjustments", headers=user, json={"amount": 5_000, "reason": "Found coins from objectives"})
    client.post("/api/account/adjustments", headers=user, json={"amount": -2_000, "reason": "Spent on packs"})
    rec = client.get("/api/account/reconcile", headers=user).json()
    assert rec["balanced"] is True, rec

    ledger = client.get("/api/ledger?page_size=200", headers=user).json()["items"]
    expected_available = 150_000 + 5_000 - 2_000 - sum(t["original_cost"] for t in ts) + sum(e["net_proceeds"] for e in ledger)
    expected_available += ts[3]["original_cost"]  # cancelled refund
    assert balance(client, user)["available_coins"] == expected_available
    report = client.get("/api/reports/performance", headers=user).json()
    assert report["net_realised_profit"] == sum(e["realised_profit"] for e in ledger)
    assert report["losing_trades"] == 1


def test_balance_adjustments_are_audited_and_validated(client, user):
    assert client.post("/api/account/adjustments", headers=user, json={"amount": 0, "reason": "nothing"}).status_code == 422
    assert client.post("/api/account/adjustments", headers=user, json={"amount": 100, "reason": ""}).status_code == 422
    r = client.post("/api/account/adjustments", headers=user, json={"amount": -200_000, "reason": "too much"})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "insufficient_coins"
    client.post("/api/account/adjustments", headers=user, json={"amount": 2_500, "reason": "Daily objectives"})
    events = client.get("/api/account/events", headers=user).json()
    assert [e["kind"] for e in events] == ["adjustment", "opening"]
    assert events[0]["reason"] == "Daily objectives" and events[0]["available_after"] == 152_500


def test_changing_starting_coins_does_not_rewrite_balance(client, user):
    r = client.put("/api/settings", headers=user, json={"starting_coins": 500_000})
    assert r.status_code == 200 and r.json()["starting_coins"] == 500_000
    assert balance(client, user)["available_coins"] == 150_000
    assert [e["kind"] for e in client.get("/api/account/events", headers=user).json()] == ["opening"]


def test_empty_performance_report(client, user):
    r = client.get("/api/reports/performance", headers=user)
    assert r.status_code == 200
    rep = r.json()
    assert rep["total_trades"] == 0 and rep["net_realised_profit"] == 0
    assert rep["best_trade"] is None
    assert rep["charts"]["cumulative_profit"] == []
    assert rep["total_portfolio_value"] == 150_000
    dash = client.get("/api/dashboard", headers=user).json()
    assert dash["metrics"]["trading_roi_pct"] == 0
    assert dash["data_status"]["mode"] == "none"


def test_unrealised_profit_not_counted_as_realised(client, user):
    item = add_card_with_prices(client, user)
    t = buy(client, user, item["card"]["id"], 10_000, target=14_000).json()
    client.patch(f"/api/transfers/{t['id']}", headers=user, json={"estimated_price": 14_000})
    rep = client.get("/api/reports/performance", headers=user).json()
    assert rep["net_realised_profit"] == 0
    assert rep["unrealised_profit"] == 13_300 - 10_000
    assert client.get(f"/api/transfers/{t['id']}", headers=user).json()["status"] == "target_reached"


def test_stale_and_missing_prices_give_watch(client, user):
    r = client.post("/api/watchlist", headers=user, json={"player_name": "No Data", "target_buy": 1000, "target_sell": 2000})
    assert r.json()["signal"] == "WATCH" and r.json()["alert_status"] == "no_data"
    item = r.json()
    old = (utcnow() - timedelta(days=3)).isoformat()
    for p in (1000, 1500, 1100):
        client.post("/api/market/prices", headers=user, json={"card_id": item["card"]["id"], "price": p, "observed_at": old})
    opp = client.post(f"/api/watchlist/{item['id']}/evaluate", headers=user).json()
    assert opp["signal"] == "WATCH" and opp["is_stale"] is True
    status = client.get("/api/market/status", headers=user).json()
    assert status["is_stale"] is True and status["mode"] == "manual"
    alerts = client.get("/api/alerts", headers=user).json()["items"]
    assert any(a["type"] == "stale_data" for a in alerts)


def test_future_timestamp_rejected(client, user):
    item = add_card_with_prices(client, user)
    future = (utcnow() + timedelta(days=1)).isoformat()
    r = client.post("/api/market/prices", headers=user, json={"card_id": item["card"]["id"], "price": 1000, "observed_at": future})
    assert r.status_code == 422


def test_manual_scanner_evaluation(client, user):
    r = client.post("/api/scanner/evaluate", headers=user, json={
        "player_name": "Meta Gold Winger", "current_price": 25_200, "historical_low": 25_000, "historical_high": 32_000})
    assert r.json()["signal"] == "BUY" and r.json()["estimated_profit"] == 5_200
    r = client.post("/api/scanner/evaluate", headers=user, json={
        "player_name": "Meta Gold Winger", "current_price": 25_200, "historical_low": 25_000, "historical_high": 32_000, "min_profit": 6_000})
    assert r.json()["signal"] == "HOLD"
    signals = client.get("/api/scanner/signals", headers=user).json()
    assert [s["signal"] for s in signals] == ["HOLD", "BUY"]


def test_csv_import(client, user):
    csv_text = "player_name,price,observed_at,platform\nCSV Card,12000,2026-10-01T10:00:00Z,cross\nCSV Card,abc,,\nCSV Card,12500,,\n"
    r = client.post("/api/market/import", headers=user, json={"csv": csv_text})
    assert r.status_code == 200
    assert r.json()["imported"] == 2 and r.json()["error_count"] == 1
    cards = client.get("/api/market/cards", headers=user).json()
    assert cards[0]["player_name"] == "CSV Card"
    prices = client.get(f"/api/market/prices?card_id={cards[0]['id']}", headers=user).json()
    assert {p["source"] for p in prices} == {"csv"}
    assert client.post("/api/market/import", headers=user, json={"csv": "foo,bar\n1,2"}).status_code == 422


def test_simulated_prices_are_labelled(client, demo_user):
    r = client.post("/api/market/simulate", headers=demo_user)
    assert r.status_code == 200 and r.json()["created"] == 2
    assert all(p["source"] == "simulated" for p in r.json()["prices"])
    assert client.get("/api/market/status", headers=demo_user).json()["mode"] == "simulated"


def test_live_refresh_requires_configured_provider(client, user):
    r = client.post("/api/market/refresh", headers=user)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "no_live_provider"


def test_user_data_isolation(client):
    a, b = signup(client), signup(client)
    item = add_card_with_prices(client, a)
    t = buy(client, a, item["card"]["id"], 10_000).json()
    assert client.get("/api/watchlist", headers=b).json() == []
    assert client.get("/api/transfers", headers=b).json() == []
    assert client.get(f"/api/transfers/{t['id']}", headers=b).status_code == 404
    assert sell(client, b, t["id"], 14_000).status_code == 404
    assert client.post(f"/api/transfers/{t['id']}/cancel", headers=b, json={}).status_code == 404
    assert client.get(f"/api/watchlist/{item['id']}", headers=b).status_code == 404
    assert client.delete(f"/api/watchlist/{item['id']}", headers=b).status_code == 404
    assert buy(client, b, item["card"]["id"], 10_000).status_code == 404
    assert client.get(f"/api/market/prices?card_id={item['card']['id']}", headers=b).status_code == 404
    assert balance(client, b)["available_coins"] == 150_000
    assert balance(client, a)["available_coins"] == 140_000


def test_auth_required_and_login(client):
    assert client.get("/api/dashboard").status_code == 401
    assert client.get("/api/dashboard", headers={"Authorization": "Bearer nope"}).status_code == 401
    signup(client, "alice", "correct-horse")
    assert client.post("/api/auth/login", json={"username": "alice", "password": "wrong-pass"}).status_code == 401
    r = client.post("/api/auth/login", json={"username": "ALICE", "password": "correct-horse"})
    assert r.status_code == 200
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert client.get("/api/auth/me", headers=h).json()["username"] == "alice"
    assert client.post("/api/auth/register", json={"username": "alice", "password": "another-pass"}).status_code == 409
    client.post("/api/auth/logout", headers=h)
    assert client.get("/api/auth/me", headers=h).status_code == 401


def test_watchlist_crud_search_sort(client, user):
    a = add_card_with_prices(client, user, name="Alpha", target_buy=10_000, target_sell=20_000)
    add_card_with_prices(client, user, name="Bravo", target_buy=10_000, target_sell=12_000)
    assert client.post("/api/watchlist", headers=user, json={"player_name": "Alpha", "target_buy": 1, "target_sell": 2}).status_code == 409
    names = [w["card"]["player_name"] for w in client.get("/api/watchlist?sort=roi&order=desc", headers=user).json()]
    assert names == ["Alpha", "Bravo"]
    assert [w["card"]["player_name"] for w in client.get("/api/watchlist?q=brav", headers=user).json()] == ["Bravo"]
    r = client.patch(f"/api/watchlist/{a['id']}", headers=user, json={"favourite": True, "target_sell": 21_000})
    assert r.json()["favourite"] is True and r.json()["target_sell"] == 21_000
    assert [w["card"]["player_name"] for w in client.get("/api/watchlist?favourites=true", headers=user).json()] == ["Alpha"]
    detail = client.get(f"/api/watchlist/{a['id']}", headers=user).json()
    assert len(detail["price_history"]) == 4 and detail["opportunity"]["signal"]
    assert client.delete(f"/api/watchlist/{a['id']}", headers=user).status_code == 204
    assert len(client.get("/api/watchlist", headers=user).json()) == 1


def test_ledger_pagination_and_sort(client, user):
    client.put("/api/settings", headers=user, json={"max_investment_per_card": 10**9, "max_portfolio_exposure": 10**9})
    item = add_card_with_prices(client, user)
    for p in (11_000, 12_000, 9_000):
        t = buy(client, user, item["card"]["id"], 10_000).json()
        sell(client, user, t["id"], p)
    page = client.get("/api/ledger?page_size=2&sort=profit&order=desc", headers=user).json()
    assert page["total"] == 3 and len(page["items"]) == 2
    assert page["items"][0]["sale_price"] == 12_000
    losses = client.get("/api/ledger?outcome=loss", headers=user).json()
    assert losses["total"] == 1
    csv_text = client.get("/api/ledger/export.csv", headers=user).text
    assert csv_text.count("\n") == 4


def test_database_persistence_across_restarts(db_url):
    app = create_app(db_url, migrate=True)
    with TestClient(app) as c:
        h = signup(c, "persist", "password123")
        item = add_card_with_prices(c, h)
        t = buy(c, h, item["card"]["id"], 10_000).json()
        sell(c, h, t["id"], 14_000)
    app2 = create_app(db_url, migrate=True)
    with TestClient(app2) as c2:
        token = c2.post("/api/auth/login", json={"username": "persist", "password": "password123"}).json()["token"]
        h2 = {"Authorization": f"Bearer {token}"}
        assert balance(c2, h2)["available_coins"] == 150_000 - 10_000 + 13_300
        assert c2.get("/api/ledger", headers=h2).json()["total"] == 1
        assert len(c2.get("/api/watchlist", headers=h2).json()) == 1


def test_migrations_build_schema(tmp_path):
    url = f"sqlite:///{tmp_path / 'migrated.db'}"
    app = create_app(url, migrate=True)
    with TestClient(app) as c:
        h = demo(c)
        assert len(c.get("/api/watchlist", headers=h).json()) == 2


def test_alerts_and_settings_toggles(client, demo_user):
    h = demo_user
    alerts = client.get("/api/alerts", headers=h).json()
    assert any(a["type"] == "profit_threshold" for a in alerts["items"])
    assert alerts["unread"] >= 1
    client.post("/api/alerts/read-all", headers=h)
    assert client.get("/api/alerts?unread=true", headers=h).json()["items"] == []
    s = client.put("/api/settings", headers=h, json={"alert_prefs": {"stale_data": False}}).json()
    assert s["alert_prefs"]["stale_data"] is False and s["alert_prefs"]["below_target_buy"] is True
    assert client.put("/api/settings", headers=h, json={"alert_prefs": {"bogus": True}}).status_code == 422
    assert client.put("/api/settings", headers=h, json={"tax_rate_pct": 80}).status_code == 422
    assert client.put("/api/settings", headers=h, json={"mode": "manual"}).json()["mode"] == "manual"


def test_exposure_alert(client, user):
    client.put("/api/settings", headers=user, json={"max_portfolio_exposure": 25_000, "max_investment_per_card": 25_000})
    item = add_card_with_prices(client, user)
    buy(client, user, item["card"]["id"], 10_000, qty=2)
    types = {a["type"] for a in client.get("/api/alerts", headers=user).json()["items"]}
    assert "exposure_limit" in types

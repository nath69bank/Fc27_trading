from __future__ import annotations

import os
import uuid

os.environ.setdefault("PASSWORD_HASH_ITERATIONS", "1000")
os.environ["SEED_DEMO_USER"] = "false"
os.environ["MARKET_DATA_PROVIDER"] = "none"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import create_app  # noqa: E402


def key() -> str:
    return uuid.uuid4().hex


@pytest.fixture
def db_url(tmp_path):
    """SQLite file per test by default. Set TEST_DATABASE_URL (e.g. a throwaway PostgreSQL
    database) to run the same suite against it; the schema is reset before each test."""
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        return f"sqlite:///{tmp_path / 'test.db'}"
    from sqlalchemy import create_engine, text

    from app.db import Base

    engine = create_engine(url)
    Base.metadata.drop_all(engine)
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS alembic_version"))
    engine.dispose()
    return url


@pytest.fixture
def client(db_url):
    app = create_app(db_url, create_tables=True)
    with TestClient(app) as c:
        yield c


def signup(client, username: str | None = None, password: str = "password123") -> dict:
    username = username or f"u{uuid.uuid4().hex[:10]}"
    r = client.post("/api/auth/register", json={"username": username, "password": password})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def demo(client) -> dict:
    r = client.post("/api/auth/demo")
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture
def user(client):
    return signup(client)


@pytest.fixture
def demo_user(client):
    return demo(client)


def add_card_with_prices(client, h, name="Test Card", target_buy=10_000, target_sell=14_000, prices=(10_000, 12_000, 14_000, 10_100)):
    r = client.post("/api/watchlist", headers=h, json={"player_name": name, "target_buy": target_buy, "target_sell": target_sell})
    assert r.status_code == 201, r.text
    item = r.json()
    for p in prices:
        assert client.post("/api/market/prices", headers=h, json={"card_id": item["card"]["id"], "price": p}).status_code == 201
    return item


def buy(client, h, card_id, price, qty=1, target=14_000, k=None, **extra):
    return client.post(
        "/api/transfers", headers=h,
        json={"idempotency_key": k or key(), "card_id": card_id, "unit_price": price, "quantity": qty, "target_sell_price": target, **extra},
    )


def sell(client, h, transfer_id, price, qty=1, k=None):
    return client.post(f"/api/transfers/{transfer_id}/sell", headers=h, json={"idempotency_key": k or key(), "sale_price": price, "quantity": qty})


def balance(client, h) -> dict:
    return client.get("/api/account/balance", headers=h).json()

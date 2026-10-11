"""Runtime configuration, read from environment variables (see ../.env.example)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


ON_VERCEL = bool(os.getenv("VERCEL"))
# Vercel functions have a read-only filesystem apart from /tmp, which is wiped between
# instances. SQLite there only keeps the app booting; real data needs PostgreSQL.
EPHEMERAL_SQLITE_URL = "sqlite:////tmp/fc27_market_engine.db"


def resolve_database_url() -> str:
    """DATABASE_URL, else POSTGRES_URL (set by Vercel's Neon/Postgres integrations), else SQLite.

    Provider URLs come as postgres:// or postgresql://; SQLAlchemy needs the driver named."""
    url = os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL") or ""
    if not url:
        return EPHEMERAL_SQLITE_URL if ON_VERCEL else "sqlite:///./fc27_market_engine.db"
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


@dataclass(frozen=True)
class Settings:
    database_url: str = field(default_factory=resolve_database_url)
    # Run Alembic migrations on startup (handy for local dev and single-instance deploys).
    auto_migrate: bool = field(default_factory=lambda: _bool("AUTO_MIGRATE", True))
    # Seed the shared "demo" login (username demo / password from DEMO_PASSWORD) on startup.
    # Off by default on Vercel: a public deployment should not ship a shared, published login.
    seed_demo_user: bool = field(default_factory=lambda: _bool("SEED_DEMO_USER", not ON_VERCEL))
    demo_password: str = field(default_factory=lambda: os.getenv("DEMO_PASSWORD", "demo-trader-27"))
    # Allow anyone to spin up a private, freshly seeded demo account from the login page.
    allow_demo_signup: bool = field(default_factory=lambda: _bool("ALLOW_DEMO_SIGNUP", True))
    allow_registration: bool = field(default_factory=lambda: _bool("ALLOW_REGISTRATION", True))
    session_ttl_hours: int = field(default_factory=lambda: int(os.getenv("SESSION_TTL_HOURS", "2160")))
    password_hash_iterations: int = field(
        default_factory=lambda: int(os.getenv("PASSWORD_HASH_ITERATIONS", "390000"))
    )
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            o.strip()
            for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
            if o.strip()
        )
    )
    # Market data provider. "none" = manual / CSV / simulated data only.
    # "http_json" = an authorised provider you have permission to use (see docs/MARKET_DATA.md).
    market_data_provider: str = field(default_factory=lambda: os.getenv("MARKET_DATA_PROVIDER", "none"))
    market_data_api_url: str = field(default_factory=lambda: os.getenv("MARKET_DATA_API_URL", ""))
    market_data_api_key: str = field(default_factory=lambda: os.getenv("MARKET_DATA_API_KEY", ""))
    market_data_timeout_seconds: float = field(
        default_factory=lambda: float(os.getenv("MARKET_DATA_TIMEOUT_SECONDS", "10"))
    )
    # Screenshot import (Claude reads prices off a screenshot). Needs ANTHROPIC_API_KEY.
    screenshot_daily_limit_per_user: int = field(default_factory=lambda: int(os.getenv("SCREENSHOT_DAILY_LIMIT_PER_USER", "25")))
    screenshot_daily_limit_total: int = field(default_factory=lambda: int(os.getenv("SCREENSHOT_DAILY_LIMIT_TOTAL", "300")))
    # Directory of the built frontend (frontend/dist). Served at / when present.
    frontend_dist: str = field(default_factory=lambda: os.getenv("FRONTEND_DIST", ""))


def storage_is_persistent(url: str) -> bool:
    """False only for SQLite on Vercel, where the function filesystem is thrown away."""
    return not (ON_VERCEL and url.startswith("sqlite"))


@lru_cache
def get_settings() -> Settings:
    return Settings()

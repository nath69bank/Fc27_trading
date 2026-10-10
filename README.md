# FC 27 Market Engine

**Trade Smarter. Track Every Coin.**

A web app for analysing FC 27 Ultimate Team player prices. It spots possible trading
opportunities, manages a watchlist, simulates or records purchases and sales, tracks coins
and measures trading performance.

> Unofficial tool, not affiliated with EA SPORTS. It has **no live FC 27 prices unless you
> connect an authorised provider** (see [docs/MARKET_DATA.md](docs/MARKET_DATA.md)), and it
> never places real transfers. Trades are either simulations with virtual coins or records
> of trades you made yourself. Signals are estimates, never guaranteed profit.

## What's in the box

| Area | What it does |
|---|---|
| **Dashboard** | Available / invested coins, portfolio value, realised profit, open transfers, trading ROI. Also opportunities, transfers near target, recent trades, P&L chart, alerts and a data-source indicator |
| **Market Scanner** | `evaluate_opportunity()` on your watchlist or on prices you type in. Returns BUY / HOLD / SELL / WATCH / RISK with the reasoning behind it |
| **Watchlist** | `add_to_watchlist()`, edit, remove, search, sort, favourites, per-player detail page, evaluate on demand |
| **Active Transfers** | `execute_purchase()` with review → confirm. Update estimates and targets, mark as listed, record (partial) sales, cancel, view details |
| **Trade History** | `track_and_settle()` ledger: tax, net proceeds, realised profit, ROI. Search, sort, paginate, CSV export |
| **Performance Analytics** | `generate_performance_report()`: win rate, best and worst trades, average holding time. Charts for cumulative profit, daily/weekly profit, profit by player, ROI distribution, wins vs losses and account value |
| **Price History** | Manual entry, CSV import, demo simulation, optional live refresh. Every observation is labelled with its source and freshness |
| **Settings** | Tax, thresholds, limits, selling strategy, platform, staleness, mode, alert toggles. Also an **audited balance adjustment** workflow and the balance audit log |
| **Alerts** | In-app alerts with history: below target buy, target sell reached, profit threshold, holding limit, stale data, exposure limit |

## Quick start (local)

Requirements: Python 3.11+ and Node 20+.

```bash
# 1. Backend API on http://127.0.0.1:8000
cd backend
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
# Creates ./fc27_market_engine.db (SQLite), runs migrations and seeds the "demo" login.

# 2. Frontend on http://localhost:5173 (proxies /api to the backend)
cd ../frontend
npm install
npm run dev
```

Open http://localhost:5173. There is no login screen: each browser automatically gets its
own private, freshly seeded demo desk with 150,000 virtual coins, and returns to it on
later visits. **Start over** (the ↺ icon in the header) throws it away and opens a fresh
one. Guest desks nobody has opened for 90 days are deleted automatically.

### Single-process / production-style

```bash
cd frontend && npm ci && npm run build      # builds frontend/dist
cd ../backend && uvicorn app.main:app --host 0.0.0.0 --port 8000
# FastAPI serves the API at /api and the built app at /
```

### Docker + PostgreSQL

```bash
docker compose up --build    # http://localhost:8000, PostgreSQL 16 in the db service
```

Change the passwords in `docker-compose.yml` before exposing it anywhere.

### Vercel

`vercel.json` deploys the repo as one Vercel project with two services:

| Service | Root | Public path | What it is |
|---|---|---|---|
| `frontend` | `frontend/` | `/` (everything not under `/api`) | Vite static build; unknown paths fall back to `index.html` so deep links work |
| `backend` | `backend/` | `/api/*` | FastAPI function (`app/main.py`); sees the original `/api/...` path |

The browser calls the API on the same domain (`/api/...`), so no service-to-service
bindings are needed.

1. Import the repo in Vercel (it detects the services from `vercel.json`).
2. **Add a PostgreSQL database**: Vercel Marketplace → Neon, or `vercel install neon`.
   The integration sets `DATABASE_URL`/`POSTGRES_URL`, and the app accepts either.
   Without one, the backend falls back to SQLite in `/tmp`, which Vercel wipes. The app
   then shows a red "Temporary storage" warning, and data can disappear at any time.
3. Deploy. Migrations run on cold start, serialised with a PostgreSQL advisory lock.

The site is open: every visitor gets their own private guest desk automatically, with no
login. Set `ALLOW_DEMO_SIGNUP=false` to turn that off. Locally,
`vercel dev` runs both services together.

Configuration is via environment variables. See [`.env.example`](.env.example) for every
option with its default.

## The demo workflow

1. **Watchlist**: *Meta Gold Winger* is already there (target buy 25,000 / sell 32,000).
2. **Evaluate**: the current price 25,200 is within 102% of the 25,000 low (25,500), so
   **BUY SIGNAL**. Net at 32,000 = 32,000 × 0.95 = 30,400, profit 5,200, ROI 20.63%.
3. **Buy** (simulation): 150,000 → **124,800** available, 25,200 invested.
4. **Active Transfers → Record sale** at 32,000: tax 1,600, net 30,400.
5. **Performance**: available **155,200**, realised profit **+5,200**, ROI **20.63%**.

This exact scenario is an automated test (`test_demo_end_to_end_flow`) and was also driven
through the real UI in a browser.

## Architecture

```
frontend/  React 18 + TypeScript + Vite + Tailwind + Recharts
  src/lib/          API client (bearer token), types, formatting
  src/components/   UI kit, layout, charts, trade dialogs, opportunity card
  src/pages/        one file per section
backend/   FastAPI + SQLAlchemy 2 + Alembic
  app/engine/market_engine.py   FC27MarketEngine: pure trading maths (no I/O)
  app/services/                 persistence + business workflows that call the engine
  app/routers/api.py            REST endpoints (/api/...)
  app/models.py                 schema; alembic/versions/ holds the migrations
  tests/                        engine unit tests + API/integration tests
docs/MARKET_DATA.md             data limitations and how to go live
```

**All calculations happen on the server.** The engine is the only place that computes tax,
profit, ROI, thresholds and balances. The browser shows server results, including
the purchase review and the sale preview, and the API rejects client-supplied profit or
balance fields.

### Core engine methods

| Method | Where |
|---|---|
| `add_to_watchlist()` | `services/watchlist.py` |
| `evaluate_opportunity()` | `FC27MarketEngine.evaluate_opportunity`, run by `services/scanner.py` |
| `execute_purchase()` | `services/trading.py`, validated by `FC27MarketEngine.plan_purchase` |
| `track_and_settle()` | `services/trading.py`, computed by `FC27MarketEngine.settle` |
| `generate_performance_report()` | `services/reports.py`, summarised by `FC27MarketEngine.generate_performance_report` |

### Signal rules

* **WATCH**: missing current/low/high price, fewer than 3 observations in 30 days, or stale data.
* **RISK**: invalid or inconsistent prices, an outlier against history, volatility above your
  limit, or a buy that meets the criteria but breaches your per-card or exposure limit.
* **SELL**: current price ≥ expected sell price.
* **BUY**: price ≤ low × entry threshold (default 102%) **and** profit after tax ≥ minimum
  (default 1,000) **and** ROI ≥ minimum (default 0%).
* **HOLD**: everything else.

The expected sell price follows your **default selling strategy**: your target sell price
(default), the 30-day high, or "quick flip" (the mid-range, capped at your target).

### Coin rounding policy

* Coins are whole integers. Intermediate maths uses `Decimal`.
* Tax = gross × rate, **rounded half-up** to a whole coin. Net = gross − tax, so the
  ledger always reconciles.
* Caps (entry threshold, suggested max buy) round **down**, so suggestions never exceed a rule.
* Percentages are rounded half-up to 2 dp and stored as integer basis points.

### Integrity and security

* **Atomic money movement**: purchase, sale, cancel and adjustment each run in one
  transaction that updates the balance, the transfer, the ledger and an append-only
  **balance audit journal** together.
* **No double spending or double settlement**: every coin-moving operation first claims the
  account (`SELECT … FOR UPDATE` on PostgreSQL, plus a versioned compare-and-set that also
  serialises SQLite). Transfers and balances are optimistically versioned. Each purchase and
  sale carries a client request ID with a unique constraint, so retries and double-clicks
  replay the original result.
* `GET /api/account/reconcile` re-derives balances from the journal and open transfers.
* Changing the **starting coins** setting never rewrites history. Coins move only through
  trades or audited adjustments with a mandatory reason.
* Access: no login screen. Each browser gets a guest desk reached only through its own
  bearer token (only the token's SHA-256 is stored; guests have no usable password). The
  token is renewed while the visitor keeps coming back. The register/login API (PBKDF2-SHA256)
  is still there for adding real accounts later. Every query is scoped to the signed-in user, and other users' records return 404.
* Validation on both client and server (Pydantic with `extra="forbid"`, then the service rules).
* Database errors return a safe 503 ("No changes were saved") without leaking internals.

## Tests

```bash
cd backend && pytest                       # 62 tests, SQLite
TEST_DATABASE_URL=postgresql+psycopg://user:pass@localhost/fc27_test pytest   # same suite on PostgreSQL
```

Covered: opportunity evaluation (every signal), tax maths and rounding, positive and negative
profit, insufficient coins and limits, several cards with the same name, partial sales,
duplicate and **concurrent** settlement, concurrent purchases, balance reconciliation, empty
reports, invalid/stale/future prices, CSV import, the live-provider contract (mocked),
persistence across restarts, Alembic migrations, user data isolation, auth, and the full
demo scenario. CI (`.github/workflows/ci.yml`) runs the suite on SQLite and PostgreSQL,
checks migrations match the models, and builds the frontend.

## API overview

All routes are under `/api`, and all except `auth/*` and `health` need
`Authorization: Bearer <token>`. Interactive docs are at `/docs` when the server is running.

`auth/register|login|demo|logout|me` · `dashboard` · `watchlist` (CRUD, `/{id}/evaluate`) ·
`scanner/evaluate|scan|signals` · `market/status|cards|prices|import|simulate|refresh` ·
`transfers` (list, `preview`, create, `/{id}` get/patch, `/{id}/sell`, `/{id}/sell/preview`, `/{id}/cancel`) ·
`ledger`, `ledger/export.csv` · `reports/performance` · `alerts` (`/read-all`, `/{id}/read`) ·
`settings` · `account/balance|events|adjustments|reconcile`

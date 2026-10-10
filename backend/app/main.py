"""FastAPI application factory."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import SQLAlchemyError

from .config import get_settings
from .db import Base, Database
from .routers.api import router
from .services.common import ServiceError

log = logging.getLogger("fc27")
BACKEND_DIR = Path(__file__).resolve().parent.parent


def run_migrations(url: str) -> None:
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    cfg.attributes["url_set"] = True
    command.upgrade(cfg, "head")


def create_app(database_url: str | None = None, *, migrate: bool | None = None, create_tables: bool = False) -> FastAPI:
    settings = get_settings()
    db = Database(database_url or settings.database_url)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if create_tables:
            Base.metadata.create_all(db.engine)
        elif migrate if migrate is not None else settings.auto_migrate:
            run_migrations(db.url)
        if settings.seed_demo_user:
            from .seed import ensure_shared_demo_user

            session = db.SessionLocal()
            try:
                ensure_shared_demo_user(session, settings.demo_password)
            finally:
                session.close()
        yield
        db.engine.dispose()

    app = FastAPI(title="FC 27 Market Engine", version="1.0.0", lifespan=lifespan)
    app.state.db = db
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["*"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.exception_handler(ServiceError)
    async def service_error(_req: Request, exc: ServiceError):
        return JSONResponse(status_code=exc.status, content={"detail": {"code": exc.code, "message": exc.message}})

    @app.exception_handler(RequestValidationError)
    async def validation_error(_req: Request, exc: RequestValidationError):
        errors = exc.errors()
        first = errors[0] if errors else {}
        field = ".".join(str(p) for p in first.get("loc", [])[1:]) or "request"
        return JSONResponse(
            status_code=422,
            content={
                "detail": {
                    "code": "validation_error",
                    "message": f"{field}: {first.get('msg', 'invalid value')}",
                    "errors": [{"loc": list(e.get("loc", [])), "msg": e.get("msg")} for e in errors],
                }
            },
        )

    @app.exception_handler(SQLAlchemyError)
    async def db_error(_req: Request, exc: SQLAlchemyError):
        log.exception("database error", exc_info=exc)
        return JSONResponse(
            status_code=503,
            content={"detail": {"code": "database_error", "message": "A database error occurred. No changes were saved."}},
        )

    app.include_router(router)

    dist = Path(settings.frontend_dist) if settings.frontend_dist else BACKEND_DIR.parent / "frontend" / "dist"
    if (dist / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            target = dist / path
            if path and target.is_file() and dist in target.resolve().parents:
                return FileResponse(target)
            return FileResponse(dist / "index.html")

    return app


app = create_app()

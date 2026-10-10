from __future__ import annotations

from collections.abc import Iterator

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from .models import User
from .security import user_for_token


def get_db(request: Request) -> Iterator[Session]:
    yield from request.app.state.db.session()


def bearer_token(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail={"code": "unauthenticated", "message": "Sign in to continue."})
    return authorization.split(" ", 1)[1].strip()


def current_user(token: str = Depends(bearer_token), db: Session = Depends(get_db)) -> User:
    user = user_for_token(db, token)
    if user is None:
        raise HTTPException(status_code=401, detail={"code": "session_expired", "message": "Your session has expired. Sign in again."})
    return user

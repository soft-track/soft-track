"""Personal API tokens (#90): long-lived credentials a person makes and revokes.

A token looks like `softtrack_<43 random characters>`. The fixed prefix is so
a leaked one is recognisable -- by a secret scanner, or by a person reading a
log -- and it is also how `get_current_user` tells a token from a session JWT.

What a token may not do: manage tokens, or change the password. A token that
could mint another would survive its own revocation, and one that could set
the password could take the account. Those need a signed-in session; see
`require_session`.

Nothing here logs a secret. The secret exists in memory for the one request
that creates it and in the response to that request, and nowhere else.
"""

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, Request
from sqlalchemy import delete
from sqlmodel import Session, select

from lib_identity.models.api_tokens import ApiTokenCreate, ApiTokenCreated, ApiTokenRead
from lib_softtrack.tables import ApiToken, User, utcnow
from lib_utils.errors import ErrorCode, api_error

PREFIX = "softtrack_"

#: How stale `last_used_at` may get before a request refreshes it.
_LAST_USED_RESOLUTION = timedelta(minutes=1)


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    """SQLite hands back naive datetimes; Postgres does not. Normalise."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def is_api_token(bearer: str) -> bool:
    return bearer.startswith(PREFIX)


def _to_read(token: ApiToken) -> ApiTokenRead:
    return ApiTokenRead(
        id=token.id,
        name=token.name,
        hint=f"{PREFIX}…{token.hint}",
        created_at=token.created_at,
        last_used_at=token.last_used_at,
        expires_at=token.expires_at,
    )


def create_token(
    session: Session, user: User, payload: ApiTokenCreate
) -> ApiTokenCreated:
    secret = PREFIX + secrets.token_urlsafe(32)
    token = ApiToken(
        user_id=user.id,
        name=payload.name.strip(),
        token_hash=_hash(secret),
        hint=secret[-4:],
        expires_at=(
            utcnow() + timedelta(days=payload.expires_in_days)
            if payload.expires_in_days
            else None
        ),
    )
    session.add(token)
    session.commit()
    session.refresh(token)
    return ApiTokenCreated(**_to_read(token).model_dump(), token=secret)


def list_tokens(session: Session, user: User) -> list[ApiTokenRead]:
    tokens = session.exec(
        select(ApiToken)
        .where(ApiToken.user_id == user.id)
        .order_by(ApiToken.created_at)
    ).all()
    return [_to_read(token) for token in tokens]


def revoke_token(session: Session, user: User, token_id: int) -> None:
    """Delete the row. The next request with that token finds nothing: there
    is no cache in front of the lookup, so revoking is immediate."""
    token = session.get(ApiToken, token_id)
    if token is None or token.user_id != user.id:
        raise api_error(
            status_code=404,
            code=ErrorCode.api_token_not_found,
            detail="Token not found",
        )
    session.delete(token)
    session.commit()


def revoke_all(session: Session, user_id: int) -> None:
    """Every token of one account. Deactivation calls this: the tokens die
    with the account rather than waking up again if it is reactivated."""
    session.execute(delete(ApiToken).where(ApiToken.user_id == user_id))


def authenticate(session: Session, secret: str) -> Optional[User]:
    """The active user a token belongs to, or None if it is no good."""
    digest = _hash(secret)
    token = session.exec(select(ApiToken).where(ApiToken.token_hash == digest)).first()
    # The lookup found the row by its hash; the comparison is repeated in
    # constant time so nothing about the stored value leaks through timing.
    if token is None or not hmac.compare_digest(token.token_hash, digest):
        return None
    now = utcnow()
    expires_at = _aware(token.expires_at)
    if expires_at is not None and expires_at <= now:
        return None
    user = session.get(User, token.user_id)
    if user is None or not user.is_active:
        return None

    last_used = _aware(token.last_used_at)
    if last_used is None or now - last_used >= _LAST_USED_RESOLUTION:
        token.last_used_at = now
        session.add(token)
        session.commit()
    return user


def require_session(request: Request) -> None:
    """Refuse a request made with an API token rather than a signed-in session.

    Used on the routes that manage credentials. Depends on `get_current_user`
    having run first, which marks the request when a token was used.
    """
    if getattr(request.state, "via_api_token", False):
        raise api_error(
            status_code=403,
            code=ErrorCode.api_token_not_allowed,
            detail="An API token cannot do this. Sign in to manage tokens and passwords.",
        )


RequireSession = Depends(require_session)

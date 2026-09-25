"""Resetting a forgotten password by email (#83).

Two requests. The first asks for a link and always gets the same answer,
whether or not the address has an account. The second trades the link's token
for a new password, and signs every existing session out.

What keeps the first request from answering "does this address have an
account?" -- the question an attacker asks before trying passwords:

- The response is the same 204 either way, and the throttle is keyed on the
  address *typed*, so a 429 says nothing about whether it exists.
- The mail is sent after the response, not before it, so the few hundred
  milliseconds an SMTP round trip takes cannot be timed from outside. What is
  left to time is one indexed insert, which is lost in network jitter.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import delete
from sqlmodel import Session, select

from lib_identity.identity import find_user_by_email
from lib_softtrack.tables import PasswordReset, User, utcnow
from lib_utils.password import hash_password
from web import settings
from lib_utils.errors import ErrorCode, api_error

#: One message for a token that is wrong, expired, used, or outrun by a
#: password change. Telling them apart would help nobody but a guesser.
INVALID_LINK = "This reset link is invalid or has expired. Ask for a new one."


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _aware(value: datetime) -> datetime:
    """SQLite hands back naive datetimes; Postgres does not. Normalise."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def request_reset(session: Session, email: str) -> Optional[tuple[str, str, str]]:
    """Issue a reset link for `email`, if it belongs to an account that can use one.

    Returns `(to, subject, body)` for the caller to send after responding, or
    None when there is nothing to send: no such account, a deactivated one, or
    no mail configured. The caller answers the same way in every case.
    """
    if not settings.email_delivery_configured:
        return None
    user = find_user_by_email(session, email)
    if user is None or not user.is_active:
        return None

    # One live link per account: asking again replaces the last one, so an
    # inbox holding several never has more than one that works. Links nobody
    # used are swept on the way, so the table only ever holds live ones.
    session.execute(
        delete(PasswordReset).where(
            (PasswordReset.user_id == user.id) | (PasswordReset.expires_at < utcnow())
        )
    )

    token = secrets.token_urlsafe(32)
    minutes = settings.password_reset_expire_minutes
    session.add(
        PasswordReset(
            user_id=user.id,
            token_hash=_hash(token),
            token_version=user.token_version,
            expires_at=utcnow() + timedelta(minutes=minutes),
        )
    )
    session.commit()

    link = f"{settings.app_base_url.rstrip('/')}/reset-password?token={token}"
    body = (
        f"Hi {user.full_name},\n\n"
        f"Somebody asked to reset the password for your {settings.app_name} "
        f"account ({user.email}). To choose a new one, open this link:\n\n"
        f"{link}\n\n"
        f"It works once, for the next {minutes} minutes. Resetting your password "
        "signs you out everywhere you are signed in.\n\n"
        "If this was not you, ignore this email: your password stays as it is.\n"
    )
    return user.email, f"Reset your {settings.app_name} password", body


def reset_password(session: Session, token: str, new_password: str) -> None:
    """Set a new password from a reset link, and end every existing session."""
    reset = session.exec(
        select(PasswordReset).where(PasswordReset.token_hash == _hash(token))
    ).first()
    if reset is None:
        raise api_error(
            status_code=400, code=ErrorCode.reset_link_invalid, detail=INVALID_LINK
        )

    user = session.get(User, reset.user_id)
    usable = (
        user is not None
        and user.is_active
        and _aware(reset.expires_at) > utcnow()
        # The password changed, or every session was signed out, since the
        # link was sent: whoever holds it is not acting on the latest word.
        and reset.token_version == user.token_version
    )
    # Spent whether or not it worked -- a link that failed once is not worth
    # keeping around to be tried again.
    session.delete(reset)
    if not usable:
        session.commit()
        raise api_error(
            status_code=400, code=ErrorCode.reset_link_invalid, detail=INVALID_LINK
        )

    user.hashed_password = hash_password(new_password)
    # Every session ends. Somebody who could not remember the password may
    # well be resetting it because somebody else knows it.
    user.token_version += 1
    session.add(user)
    session.commit()

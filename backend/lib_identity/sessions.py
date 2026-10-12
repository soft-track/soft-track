"""Where an account is signed in, one row per browser (#308).

A session is an `AuthSession` row made at sign-in -- with a password, with
Google or GitHub, or by registering -- and its id travels in the token as
`sid`. Every request made with that token looks the row up by its primary
key, so revoking one session refuses its next request and leaves the others
alone. That one indexed read is the whole cost; `last_used_at` is written at
most once a minute.

What ends a session:
- revoking it from Settings → Security, or signing out in that browser;
- anything that moves the account's `token_version` on -- "sign out
  everywhere", a password change or reset, deactivation, a site admin's "end
  all sessions" -- which ends every row at once without touching any of them;
- thirty days without a request, or its token expiring.

What is not a session: an API token (`lib_identity/api_tokens.py`), which has
its own list. And a token signed before this existed carries no `sid`; it is
checked as it always was and keeps working until it expires.

Nothing here locates an address or fingerprints a device. The User-Agent
header is kept as sent and read back only as "Firefox on Linux".
"""

import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import BackgroundTasks, Request
from sqlalchemy import delete
from sqlmodel import Session, col, func, select

from lib_identity.models.identity import Token, UserMe
from lib_identity.models.sessions import SessionRead
from lib_softtrack.tables import AuthSession, User, utcnow
from lib_utils.errors import ErrorCode, api_error
from lib_utils.mailer import get_mailer, send_quietly
from lib_utils.rate_limit import address_of
from lib_utils.token import create_access_token
from web import settings

#: A session nobody has used for this long ends by itself.
IDLE_LIMIT = timedelta(days=30)

#: How long an ended or stale row is kept, so a sign-in can still tell a
#: browser the account has used before. Swept at the account's next sign-in.
KEEP_ENDED = timedelta(days=90)

#: How stale `last_used_at` may get before a request refreshes it.
_LAST_USED_RESOLUTION = timedelta(minutes=1)

_USER_AGENT_LIMIT = 512

#: First match wins, so the order matters: Edge and Opera say "Chrome" too,
#: and Chrome says "Safari".
_BROWSERS = (
    (re.compile(r"Edg(e|A|iOS)?/"), "Edge"),
    (re.compile(r"OPR/|Opera"), "Opera"),
    (re.compile(r"Firefox/|FxiOS/"), "Firefox"),
    (re.compile(r"Chrome/|CriOS/|Chromium/"), "Chrome"),
    (re.compile(r"Safari/"), "Safari"),
)

#: The same: an iPhone says "like Mac OS X", and Android says "Linux".
_SYSTEMS = (
    (re.compile(r"iPhone"), "iPhone"),
    (re.compile(r"iPad"), "iPad"),
    (re.compile(r"Android"), "Android"),
    (re.compile(r"CrOS"), "ChromeOS"),
    (re.compile(r"Windows"), "Windows"),
    (re.compile(r"Macintosh|Mac OS X"), "macOS"),
    (re.compile(r"Linux|X11"), "Linux"),
)


def describe(user_agent: str) -> tuple[Optional[str], Optional[str]]:
    """The browser and the system a User-Agent header names, either of them
    None when it names nothing recognisable."""
    browser = next((name for rx, name in _BROWSERS if rx.search(user_agent)), None)
    system = next((name for rx, name in _SYSTEMS if rx.search(user_agent)), None)
    return browser, system


def _aware(value: datetime) -> datetime:
    """SQLite hands back naive datetimes; Postgres does not. Normalise."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _expiry(now: datetime) -> datetime:
    return now + timedelta(minutes=settings.access_token_expire_minutes)


def _is_live(row: AuthSession, user: User, now: datetime) -> bool:
    return (
        row.ended_at is None
        and row.token_version == user.token_version
        and _aware(row.expires_at) > now
        and now - _aware(row.last_used_at) < IDLE_LIMIT
    )


def _live(now: datetime):
    """The SQL half of `_is_live`, for a query joined to the account."""
    return (
        col(AuthSession.ended_at).is_(None),
        AuthSession.token_version == User.token_version,
        AuthSession.expires_at > now,
        AuthSession.last_used_at > now - IDLE_LIMIT,
    )


def _token(user: User, row: AuthSession) -> Token:
    return Token(
        access_token=create_access_token(
            subject=str(user.id), version=user.token_version, session_id=row.id
        ),
        user=UserMe.model_validate(user),
    )


def start(
    session: Session,
    user: User,
    request: Request,
    background: Optional[BackgroundTasks] = None,
) -> Token:
    """Sign `user` in from the browser making `request`: a new row, and a
    token that carries it.

    With `background`, an account that has signed in before is emailed when
    this browser is not one it has used (on this system) in the last ninety
    days. The first session an account has after this exists is never
    "new": there is nothing yet to compare it with.
    """
    now = utcnow()
    user_agent = (request.headers.get("user-agent") or "")[:_USER_AGENT_LIMIT]
    address = address_of(request)

    session.execute(
        delete(AuthSession)
        .where(
            AuthSession.user_id == user.id,
            AuthSession.last_used_at < now - KEEP_ENDED,
        )
        .execution_options(synchronize_session="fetch")
    )
    seen = {
        describe(agent)
        for agent in session.exec(
            select(AuthSession.user_agent).where(AuthSession.user_id == user.id)
        ).all()
    }

    row = AuthSession(
        user_id=user.id,
        user_agent=user_agent,
        ip_address=address,
        token_version=user.token_version,
        created_at=now,
        last_used_at=now,
        expires_at=_expiry(now),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    session.refresh(user)

    if background is not None and seen and describe(user_agent) not in seen:
        message = _new_browser_mail(user, user_agent, address, now)
        if message is not None:
            background.add_task(send_quietly, get_mailer(), *message)
    return _token(user, row)


def _new_browser_mail(
    user: User, user_agent: str, address: str, when: datetime
) -> Optional[tuple[str, str, str]]:
    if not settings.email_delivery_configured:
        return None
    label = _label(*describe(user_agent))
    link = f"{settings.app_base_url.rstrip('/')}/settings/security"
    # Times are UTC: an account has no timezone of its own to write them in.
    moment = f"{when.day} {when:%B} at {when:%H:%M} UTC"
    body = (
        f"Hi {user.full_name},\n\n"
        f"{label} signed in on {moment}, from {address}. "
        "If that was you, there is nothing to do.\n\n"
        f"Review your sessions: {link}\n"
    )
    return user.email, f"A new sign-in to your {settings.app_name} account", body


def _label(browser: Optional[str], system: Optional[str]) -> str:
    if browser and system:
        return f"{browser} on {system}"
    return browser or (f"A browser on {system}" if system else "An unknown browser")


def reissue(session: Session, user: User, request: Request) -> Token:
    """A fresh token for the session making `request`, after the account's
    `token_version` moved on -- a password change, "sign out everywhere".

    The row is kept rather than replaced, so the tab that did it is still
    "this device", started when it started. A request made without a session
    (a token from before sessions existed) gets a new one.
    """
    row = _current_row(session, user, request)
    if row is None:
        return start(session, user, request)
    now = utcnow()
    row.token_version = user.token_version
    row.last_used_at = now
    row.expires_at = _expiry(now)
    session.add(row)
    session.commit()
    session.refresh(row)
    session.refresh(user)
    return _token(user, row)


def _current_row(
    session: Session, user: User, request: Request
) -> Optional[AuthSession]:
    session_id = getattr(request.state, "session_id", None)
    if session_id is None:
        return None
    row = session.get(AuthSession, session_id)
    return row if row is not None and row.user_id == user.id else None


def authenticate(session: Session, user: User, session_id: object) -> bool:
    """Whether the session a token names is still live, noting that it was
    used. Called on every request made with a session's token."""
    if not isinstance(session_id, int):
        return False
    row = session.get(AuthSession, session_id)
    now = utcnow()
    if row is None or row.user_id != user.id or not _is_live(row, user, now):
        return False
    if now - _aware(row.last_used_at) >= _LAST_USED_RESOLUTION:
        row.last_used_at = now
        session.add(row)
        session.commit()
    return True


def list_sessions(session: Session, user: User, request: Request) -> list[SessionRead]:
    """The account's live sessions, most recently used first."""
    now = utcnow()
    current = getattr(request.state, "session_id", None)
    rows = session.exec(
        select(AuthSession)
        .join(User, User.id == AuthSession.user_id)
        .where(AuthSession.user_id == user.id, *_live(now))
        .order_by(col(AuthSession.last_used_at).desc(), col(AuthSession.id).desc())
    ).all()
    reads = []
    for row in rows:
        browser, system = describe(row.user_agent)
        reads.append(
            SessionRead(
                id=row.id,
                browser=browser,
                system=system,
                ip_address=row.ip_address,
                created_at=row.created_at,
                last_used_at=row.last_used_at,
                current=row.id == current,
            )
        )
    # This device first, wherever its last request falls.
    reads.sort(key=lambda read: not read.current)
    return reads


def revoke(session: Session, user: User, session_id: int) -> None:
    """End one session. Its next request is refused; the others continue."""
    row = session.get(AuthSession, session_id)
    if row is None or row.user_id != user.id or not _is_live(row, user, utcnow()):
        raise api_error(
            status_code=404,
            code=ErrorCode.session_not_found,
            detail="Session not found",
        )
    row.ended_at = utcnow()
    session.add(row)
    session.commit()


def end_current(session: Session, user: User, request: Request) -> None:
    """Signing out in this browser: its row ends with it, so the list does
    not go on showing a browser that is no longer signed in."""
    row = _current_row(session, user, request)
    if row is not None and row.ended_at is None:
        row.ended_at = utcnow()
        session.add(row)
        session.commit()


def live_counts(session: Session, user_ids: list[int]) -> dict[int, int]:
    """How many live sessions each account has, for a page of them at once."""
    if not user_ids:
        return {}
    return dict(
        session.exec(
            select(AuthSession.user_id, func.count())
            .join(User, User.id == AuthSession.user_id)
            .where(col(AuthSession.user_id).in_(user_ids), *_live(utcnow()))
            .group_by(AuthSession.user_id)
        ).all()
    )

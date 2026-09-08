"""Deriving, normalising and checking `@username` handles.

Its own module because three callers need the same rules -- registration,
profile edits, and the backfill in migration b7d3e91a5c04 -- and the migration
keeps its own frozen copy, so this is the only place the live rules live.
"""

import re

from fastapi import HTTPException
from sqlmodel import Session, func, select

from lib_softtrack.tables import User

#: Lowercase, starts alphanumeric, 2-39 characters. The character class is the
#: same one MENTION_PATTERN accepts in frontend/src/markdown/mentions.ts: a
#: handle that cannot be written as an @mention would be a handle in name only.
USERNAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{1,38}$")

MAX_USERNAME_LENGTH = 39
_UNSAFE = re.compile(r"[^a-z0-9._-]+")


def normalise_username(raw: str) -> str:
    """Lowercase and validate a username the user typed."""
    username = raw.strip().lower()
    if not USERNAME_PATTERN.match(username):
        raise HTTPException(
            status_code=400,
            detail=(
                "A username is 2 to 39 characters, starts with a letter or "
                "digit, and uses only letters, digits, dots, dashes and "
                "underscores."
            ),
        )
    return username


def derive_username(session: Session, email: str) -> str:
    """A free handle based on an address, for someone who did not pick one.

    Numbered on collision rather than falling back to the whole address:
    `sam2` is something a colleague can type into a comment, and
    `sam@example.com` is not.
    """
    local = email.split("@")[0].lower().strip()
    base = _UNSAFE.sub("-", local).lstrip("._-")[:MAX_USERNAME_LENGTH] or "user"
    if len(base) < 2:
        base = f"{base}-user"

    candidate = base
    suffix = 2
    while _username_exists(session, candidate):
        tail = str(suffix)
        candidate = f"{base[: MAX_USERNAME_LENGTH - len(tail)]}{tail}"
        suffix += 1
    return candidate


def assert_username_free(
    session: Session, username: str, except_user_id: int | None = None
) -> None:
    statement = select(User).where(User.username == username)
    if except_user_id is not None:
        statement = statement.where(User.id != except_user_id)
    if session.exec(statement).first():
        raise HTTPException(status_code=400, detail="That username is taken")


def _username_exists(session: Session, username: str) -> bool:
    return (
        session.exec(
            select(func.count()).select_from(User).where(User.username == username)
        ).one()
        > 0
    )

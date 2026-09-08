"""Identity services: registration, login, the profile, and the current user."""

import hashlib
import re
import secrets
from functools import lru_cache

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlmodel import Session, func, select

from lib_identity.models.identity import Token, UserMe, UserUpdate
from lib_identity.usernames import (
    assert_username_free,
    derive_username,
    normalise_username,
)
from lib_softtrack.tables import User, utcnow
from lib_utils.password import hash_password, verify_password
from lib_utils.token import create_access_token, decode_access_token
from web import get_session, settings

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

AVATAR_COLORS = [
    "#6366f1",
    "#ec4899",
    "#14b8a6",
    "#f59e0b",
    "#8b5cf6",
    "#ef4444",
    "#22c55e",
]

_HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


def avatar_color_for(email: str) -> str:
    """Pick a stable avatar colour for an address.

    Deliberately not `hash()`: Python randomises string hashing per process
    (PYTHONHASHSEED), so the built-in would hand the same address a different
    colour after every restart. A digest is stable across processes, machines
    and releases, which is what "the same person always looks the same" needs.
    """
    digest = hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()
    return AVATAR_COLORS[int(digest, 16) % len(AVATAR_COLORS)]


def find_user_by_email(session: Session, email: str) -> User | None:
    """Look an address up without caring about its case.

    Addresses are case-insensitive in practice, and someone who registered as
    `Sam@Example.com` expects to sign in as `sam@example.com`. New rows are
    stored lowercased; older ones are matched this way instead.
    """
    return session.exec(
        select(User).where(func.lower(User.email) == email.strip().lower())
    ).first()


def get_current_user(
    token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> User:
    """FastAPI dependency resolving the bearer token to a User row."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    payload = decode_access_token(token)
    if payload is None or payload.get("sub") is None:
        raise credentials_exception
    user = session.get(User, int(payload["sub"]))
    if user is None or not user.is_active:
        raise credentials_exception
    # Tokens minted before this feature carry no `ver`, and every existing row
    # is at version 0, so the default matches and nobody is signed out by the
    # upgrade itself.
    if payload.get("ver", 0) != user.token_version:
        raise credentials_exception
    return user


def _issue_token(user: User) -> Token:
    return Token(
        access_token=create_access_token(
            subject=str(user.id), version=user.token_version
        ),
        user=UserMe.model_validate(user),
    )


def register_user(
    session: Session,
    email: str,
    password: str,
    full_name: str,
    username: str | None = None,
    invite_token: str | None = None,
) -> Token:
    from lib_softtrack.invites import accept_invite, find_live_invite

    email = email.strip().lower()
    if find_user_by_email(session, email):
        raise HTTPException(status_code=400, detail="Email already registered")

    # On a closed instance the invitation is the credential that lets someone
    # create an account at all -- checked against the address rather than the
    # link, so a shared link cannot sign up a stranger.
    if not settings.open_registration and not find_live_invite(session, email):
        raise HTTPException(
            status_code=403,
            detail="Registration on this SoftTrack is by invitation",
        )

    if username is not None:
        handle = normalise_username(username)
        assert_username_free(session, handle)
    else:
        handle = derive_username(session, email)

    # The first account to exist owns the instance. Nobody else can grant it,
    # so it has to be automatic or a fresh install has no administrator.
    is_first = session.exec(select(func.count()).select_from(User)).one() == 0

    user = User(
        email=email,
        username=handle,
        hashed_password=hash_password(password),
        full_name=full_name,
        avatar_color=avatar_color_for(email),
        is_site_admin=is_first,
        # Registering hands out a token, so it *is* a sign-in. Leaving this
        # null would show someone who signed up a minute ago as "never signed
        # in" in the admin directory.
        last_login_at=utcnow(),
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    if invite_token:
        # Best effort: a bad or expired token should not undo an account that
        # has already been created. The invite is still listed on /auth/me.
        try:
            accept_invite(session, user, invite_token)
        except HTTPException:
            pass

    return _issue_token(user)


@lru_cache(maxsize=1)
def _unmatchable_hash() -> str:
    """A bcrypt hash of a random string, so no password can ever match it.

    Computed once, lazily, because bcrypt at the default cost takes a
    noticeable fraction of a second and importing this module should not.
    """
    return hash_password(secrets.token_urlsafe(32))


def warm_password_hasher() -> None:
    """Fill the decoy-hash cache at startup. See `_unmatchable_hash`."""
    _unmatchable_hash()


def login_user(session: Session, email: str, password: str) -> Token:
    user = find_user_by_email(session, email)

    # Verify against a hash that cannot match rather than returning early, so
    # an unknown address costs the same ~100ms of bcrypt as a known one with
    # the wrong password. The early return was a clean timing oracle: the two
    # answers are worded identically, but one came back in microseconds, which
    # told an attacker exactly which addresses have accounts here.
    hashed = user.hashed_password if user else _unmatchable_hash()
    password_matches = verify_password(password, hashed)

    if not user or not password_matches:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    # After the password check, not before: answering "deactivated" to a wrong
    # password would confirm the address exists to someone guessing.
    if not user.is_active:
        raise HTTPException(status_code=403, detail="This account has been deactivated")

    user.last_login_at = utcnow()
    session.add(user)
    session.commit()
    session.refresh(user)
    return _issue_token(user)


def update_profile(session: Session, user: User, payload: UserUpdate) -> User:
    if payload.full_name is not None:
        name = payload.full_name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="A name cannot be empty")
        user.full_name = name

    if payload.username is not None:
        handle = normalise_username(payload.username)
        assert_username_free(session, handle, except_user_id=user.id)
        user.username = handle

    if payload.avatar_color is not None:
        if not _HEX_COLOR.match(payload.avatar_color):
            raise HTTPException(status_code=400, detail="A colour looks like #6366f1")
        user.avatar_color = payload.avatar_color.lower()

    if payload.email is not None:
        email = payload.email.strip().lower()
        if email != user.email.lower():
            if not payload.current_password or not verify_password(
                payload.current_password, user.hashed_password
            ):
                raise HTTPException(
                    status_code=400,
                    detail="Enter your current password to change your email",
                )
            existing = find_user_by_email(session, email)
            if existing and existing.id != user.id:
                raise HTTPException(status_code=400, detail="Email already registered")
            user.email = email

    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def change_password(session: Session, user: User, current: str, new: str) -> Token:
    if not verify_password(current, user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    user.hashed_password = hash_password(new)
    # Every other session dies here. That is the point of changing a password
    # you think somebody else knows.
    user.token_version += 1
    session.add(user)
    session.commit()
    session.refresh(user)
    # A fresh token for the tab that made the change, so the person who just
    # secured their account is not the one thrown out of it.
    return _issue_token(user)


def sign_out_everywhere(session: Session, user: User) -> Token:
    user.token_version += 1
    session.add(user)
    session.commit()
    session.refresh(user)
    return _issue_token(user)


def list_my_invites(session: Session, user: User):
    """Invitations waiting for this person, wherever they came from.

    Lives here rather than in lib_softtrack.invites because it is scoped to the
    signed-in user rather than to a team -- and it is what lets someone with no
    teams at all get into one.
    """
    from lib_softtrack.invites import list_invites_for_user

    return list_invites_for_user(session, user)

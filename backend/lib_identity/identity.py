"""Identity services: registration, login, and resolving the current user."""

import hashlib
import secrets
from functools import lru_cache

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlmodel import Session, select

from lib_identity.models.identity import Token, UserPublic
from lib_softtrack.tables import User
from lib_utils.password import hash_password, verify_password
from lib_utils.token import create_access_token, decode_access_token
from web import get_session

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


def avatar_color_for(email: str) -> str:
    """Pick a stable avatar colour for an address.

    Deliberately not `hash()`: Python randomises string hashing per process
    (PYTHONHASHSEED), so the built-in would hand the same address a different
    colour after every restart. A digest is stable across processes, machines
    and releases, which is what "the same person always looks the same" needs.
    """
    digest = hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()
    return AVATAR_COLORS[int(digest, 16) % len(AVATAR_COLORS)]


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
    subject = decode_access_token(token)
    if subject is None:
        raise credentials_exception
    user = session.get(User, int(subject))
    if user is None:
        raise credentials_exception
    return user


def register_user(session: Session, email: str, password: str, full_name: str) -> Token:
    existing = session.exec(select(User).where(User.email == email)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=email,
        hashed_password=hash_password(password),
        full_name=full_name,
        avatar_color=avatar_color_for(email),
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    token = create_access_token(subject=str(user.id))
    return Token(access_token=token, user=UserPublic.model_validate(user))


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
    user = session.exec(select(User).where(User.email == email)).first()

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
    token = create_access_token(subject=str(user.id))
    return Token(access_token=token, user=UserPublic.model_validate(user))

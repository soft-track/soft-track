"""Identity services: registration, login, and resolving the current user."""

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
        avatar_color=AVATAR_COLORS[hash(email) % len(AVATAR_COLORS)],
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    token = create_access_token(subject=str(user.id))
    return Token(access_token=token, user=UserPublic.model_validate(user))


def login_user(session: Session, email: str, password: str) -> Token:
    user = session.exec(select(User).where(User.email == email)).first()
    if not user or not verify_password(password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    token = create_access_token(subject=str(user.id))
    return Token(access_token=token, user=UserPublic.model_validate(user))

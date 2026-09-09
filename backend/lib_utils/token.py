from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from web import settings


def create_access_token(
    subject: str, version: int = 0, expires_minutes: int | None = None
) -> str:
    """Sign a bearer token for `subject`, stamped with their token version.

    The version is what makes a token revocable. Tokens live for a week, so
    without it a password change, a "sign out everywhere" or a deactivation
    would be advisory for up to seven days.
    """
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=expires_minutes or settings.access_token_expire_minutes
    )
    to_encode = {"sub": subject, "exp": expire, "ver": version}
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)


def decode_access_token(token: str) -> dict | None:
    """The token's claims, or None if it is not a valid token for this instance.

    Returns the whole payload rather than just the subject because the caller
    has to check `ver` as well, and splitting that across two decodes would
    mean verifying the signature twice.
    """
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        return None


_TOTP_PENDING_SCOPE = "totp_pending"
_TOTP_PENDING_MINUTES = 5


def create_totp_pending_token(user_id: int, version: int = 0) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=_TOTP_PENDING_MINUTES)
    payload = {
        "sub": str(user_id),
        "ver": version,
        "scope": _TOTP_PENDING_SCOPE,
        "exp": expire,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_totp_pending_token(token: str) -> tuple[int, int] | None:
    try:
        payload = jwt.decode(
            token, settings.secret_key, algorithms=[settings.algorithm]
        )
        if payload.get("scope") != _TOTP_PENDING_SCOPE:
            return None
        sub = payload.get("sub")
        if sub is None:
            return None
        ver = payload.get("ver", 0)
        return int(sub), int(ver)
    except (JWTError, ValueError, TypeError):
        return None


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

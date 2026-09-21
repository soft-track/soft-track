from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from web import settings

#: Stamped on every token this function signs. The instance signs other things
#: with the same key -- the OAuth state cookie, the exchange and link tickets
#: in `lib_identity/oauth.py` -- and each carries its own `typ`, so none of them
#: can be presented as a session. Tokens minted before this existed carry no
#: `typ` at all, which is why `None` is accepted too and not treated as a
#: forgery.
ACCESS_TOKEN_TYPE = "access"


def is_access_token(payload: dict) -> bool:
    """Whether these claims are a session token rather than something else."""
    return payload.get("typ") in (None, ACCESS_TOKEN_TYPE)


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
    to_encode = {
        "sub": subject,
        "exp": expire,
        "ver": version,
        "typ": ACCESS_TOKEN_TYPE,
    }
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

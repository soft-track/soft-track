import secrets

import bcrypt

# bcrypt has a hard 72-byte input limit; truncate defensively so long
# passphrases don't raise instead of just losing entropy past that point.
_MAX_PASSWORD_BYTES = 72

#: Marks a stored hash that no password can ever match. `$` starts every real
#: bcrypt hash, so a leading `!` cannot collide with one, and the convention is
#: old enough to be recognised on sight.
UNUSABLE_PREFIX = "!"


def hash_password(password: str) -> str:
    truncated = password.encode("utf-8")[:_MAX_PASSWORD_BYTES]
    return bcrypt.hashpw(truncated, bcrypt.gensalt()).decode("utf-8")


def unusable_password() -> str:
    """A password field for an account that signs in some other way.

    The column is NOT NULL and every caller expects a string, so an account
    created by signing in with Google gets this rather than a nullable column
    and a `None` check at each of the places that read it. Random after the
    marker so that two such accounts do not share a value -- there is nothing
    to learn from that, and nothing to gain by allowing it either.
    """
    return f"{UNUSABLE_PREFIX}{secrets.token_urlsafe(32)}"


def is_usable_password(hashed_password: str) -> bool:
    """Whether this account can be signed into with a password at all."""
    return bool(hashed_password) and not hashed_password.startswith(UNUSABLE_PREFIX)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not is_usable_password(hashed_password):
        # Checked before bcrypt rather than left to the ValueError below, so
        # the answer does not depend on bcrypt's opinion of a string that was
        # never a hash. Callers that must not leak *which* accounts have no
        # password -- `login_user` -- spend the same time either way by
        # verifying against a decoy hash instead of against this one.
        return False
    truncated = plain_password.encode("utf-8")[:_MAX_PASSWORD_BYTES]
    try:
        return bcrypt.checkpw(truncated, hashed_password.encode("utf-8"))
    except ValueError:
        return False

"""TOTP two-factor authentication: secrets, codes and recovery codes.

The secret is stored encrypted with a key derived from `SECRET_KEY`, so a
database dump on its own is not enough to mint codes. The flip side is that
rotating `SECRET_KEY` makes every stored secret unreadable -- which is
reported as `TotpSecretUnreadable` and logged, never mistaken for a wrong
code. An operator who rotates the key has to clear 2FA for the affected
accounts from the admin directory.
"""

import base64
import hashlib
import hmac
import json
import logging
import secrets
import time
from typing import Optional

import pyotp
from cryptography.fernet import Fernet, InvalidToken

from web import settings

logger = logging.getLogger(__name__)


class TotpSecretUnreadable(Exception):
    """A stored secret that cannot be decrypted with the current key."""


def _now() -> float:
    """The current time, behind a seam so the tests can move the clock."""
    return time.time()


def _get_fernet() -> Fernet:
    key = base64.urlsafe_b64encode(
        hashlib.sha256(settings.secret_key.encode("utf-8")).digest()
    )
    return Fernet(key)


def encrypt_secret(secret: str) -> str:
    return _get_fernet().encrypt(secret.encode("utf-8")).decode("utf-8")


def decrypt_secret(encrypted: str) -> str:
    """The Base32 secret, or `TotpSecretUnreadable`.

    No fallback to treating the stored value as plaintext: nothing has ever
    written one, so a failure here means `SECRET_KEY` changed or the row is
    corrupt -- and both deserve a log line rather than a "wrong code".
    """
    try:
        return _get_fernet().decrypt(encrypted.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError) as exc:
        logger.error(
            "A stored TOTP secret could not be decrypted -- was SECRET_KEY rotated?"
        )
        raise TotpSecretUnreadable() from exc


def generate_secret() -> str:
    return pyotp.random_base32()


def provisioning_uri(secret: str, email: str, issuer: str = "SoftTrack") -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=issuer)


def verify_code_with_step(
    secret: str,
    code: str,
    drift: int = 1,
    last_time_step: Optional[int] = None,
) -> tuple[bool, Optional[int]]:
    """Whether `code` is valid within +/-`drift` steps, and which step it was.

    A step at or before `last_time_step` is refused, so a code that has been
    accepted once cannot be accepted again -- by any endpoint, since every
    caller records the step it matched. `secret` is a decrypted secret; only
    the code is untrusted here, so nothing is caught broadly.
    """
    code = code.strip()
    if not code.isdigit():
        return False, None
    totp = pyotp.TOTP(secret)
    now_step = int(_now() / totp.interval)
    for step in range(now_step - drift, now_step + drift + 1):
        if last_time_step is not None and step <= last_time_step:
            continue
        if hmac.compare_digest(totp.generate_otp(step), code):
            return True, step
    return False, None


_RECOVERY_CODE_COUNT = 10
_RECOVERY_CODE_BYTES = 12


def _hash_code(code: str) -> str:
    return hmac.new(
        settings.secret_key.encode("utf-8"),
        code.strip().encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def generate_recovery_codes() -> tuple[list[str], list[str]]:
    plain = [
        secrets.token_urlsafe(_RECOVERY_CODE_BYTES) for _ in range(_RECOVERY_CODE_COUNT)
    ]
    hashed = [_hash_code(c) for c in plain]
    return plain, hashed


def encode_recovery_codes(hashed_codes: list[str]) -> str:
    return json.dumps(hashed_codes)


def decode_recovery_codes(raw: Optional[str]) -> list[str]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [str(item) for item in data if isinstance(item, (str, int))]
        return []
    except (ValueError, TypeError):
        return []


def check_recovery_code(
    plain_code: str,
    hashed_codes: list[str],
) -> tuple[bool, list[str]]:
    target = _hash_code(plain_code)
    matched_index: Optional[int] = None

    # No early exit: comparing every stored hash keeps the time the same
    # wherever in the list the match is.
    for i, stored in enumerate(hashed_codes):
        if isinstance(stored, str) and hmac.compare_digest(target, stored):
            matched_index = i

    if matched_index is None:
        return False, hashed_codes

    remaining = [h for i, h in enumerate(hashed_codes) if i != matched_index]
    return True, remaining

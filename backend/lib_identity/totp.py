import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Optional

from cryptography.fernet import Fernet
import pyotp

from web import settings


def _get_fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(settings.secret_key.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_secret(secret: str) -> str:
    return _get_fernet().encrypt(secret.encode("utf-8")).decode("utf-8")


def decrypt_secret(encrypted: str) -> str:
    try:
        return _get_fernet().decrypt(encrypted.encode("utf-8")).decode("utf-8")
    except Exception:
        # Fallback in case raw plaintext Base32 secret was present
        return encrypted


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
    try:
        totp = pyotp.TOTP(secret)
        now_step = int(time.time() / totp.interval)
        for step in range(now_step - drift, now_step + drift + 1):
            if last_time_step is not None and step <= last_time_step:
                continue
            expected_otp = totp.generate_otp(step)
            if hmac.compare_digest(expected_otp, code.strip()):
                return True, step
        return False, None
    except Exception:
        return False, None


def verify_code(secret: str, code: str, drift: int = 1) -> bool:
    valid, _ = verify_code_with_step(secret, code, drift=drift)
    return valid


_RECOVERY_CODE_COUNT = 10
_RECOVERY_CODE_BYTES = 12


def _hash_code(code: str) -> str:
    return hmac.new(
        settings.secret_key.encode("utf-8"),
        code.strip().encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def generate_recovery_codes() -> tuple[list[str], list[str]]:
    plain = [secrets.token_urlsafe(_RECOVERY_CODE_BYTES) for _ in range(_RECOVERY_CODE_COUNT)]
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

    for i, stored in enumerate(hashed_codes):
        if isinstance(stored, str) and hmac.compare_digest(target, stored):
            matched_index = i

    if matched_index is None:
        return False, hashed_codes

    remaining = [h for i, h in enumerate(hashed_codes) if i != matched_index]
    return True, remaining

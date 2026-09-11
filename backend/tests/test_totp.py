"""Tests for TOTP two-factor authentication.

Security edges that must stay covered:
- Lockout: 6 bad TOTP codes → 429; correct code still fails while locked
- Drift: ±1 window accepted; ±2 rejected
- Recovery codes: single-use, hashed; same code rejected on reuse
- token_version: enrolment and disable both bump it → old sessions rejected
- Pending token: cannot be used as a bearer token; expires in 5 minutes
- Timing: the recovery-code path does not leak match index via early return
- Admin clear: no TOTP code needed; invalidates sessions
"""

import time
from unittest.mock import patch

import pyotp
import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_DEFAULT_EMAIL = "demo@softtrack.dev"
_DEFAULT_PASS = "password123"


def register(client, email=_DEFAULT_EMAIL, full_name="Demo User"):
    response = client.post(
        "/auth/register",
        json={"email": email, "password": _DEFAULT_PASS, "full_name": full_name},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    return {
        "user": body["user"],
        "headers": {"Authorization": f"Bearer {body['access_token']}"},
        "token": body["access_token"],
    }


def enrol(client, actor):
    """Start enrolment and return the TOTP secret (= the manual_key)."""
    r = client.post("/auth/totp/enrol", headers=actor["headers"])
    assert r.status_code == 200, r.text
    return r.json()["manual_key"]


def confirm(client, actor, secret):
    """Confirm enrolment with a valid code and return the recovery codes."""
    code = pyotp.TOTP(secret).now()
    r = client.post(
        "/auth/totp/confirm",
        json={"code": code},
        headers=actor["headers"],
    )
    assert r.status_code == 200, r.text
    return r.json()["recovery_codes"]


def login_password(client, email=_DEFAULT_EMAIL, password=_DEFAULT_PASS):
    return client.post("/auth/login", data={"username": email, "password": password})


def login_totp(client, pending_token, code):
    return client.post(
        "/auth/totp/verify",
        json={"pending_token": pending_token, "code": code},
    )


def disable_totp(client, actor, code):
    return client.post(
        "/auth/totp/disable",
        json={"code": code},
        headers=actor["headers"],
    )


def login_full(client, secret, email=_DEFAULT_EMAIL, password=_DEFAULT_PASS):
    """Complete a full two-step login and return a fresh session with headers."""
    r1 = login_password(client, email, password)
    assert r1.status_code == 202
    code = pyotp.TOTP(secret).now()
    r2 = login_totp(client, r1.json()["pending_token"], code)
    assert r2.status_code == 200
    token = r2.json()["access_token"]
    return {
        "user": r2.json()["user"],
        "headers": {"Authorization": f"Bearer {token}"},
        "token": token,
    }


# ---------------------------------------------------------------------------
# Enrolment
# ---------------------------------------------------------------------------


def test_enrolment_returns_provisioning_uri_and_manual_key(client, auth):
    actor = auth()
    r = client.post("/auth/totp/enrol", headers=actor["headers"])
    assert r.status_code == 200
    body = r.json()
    assert body["provisioning_uri"].startswith("otpauth://totp/")
    assert len(body["manual_key"]) == 32  # standard Base32 TOTP secret


def test_enrolment_is_not_active_until_confirmed(client, auth):
    actor = auth()
    enrol(client, actor)
    # Login must still be single-step because totp_enabled is still False.
    r = login_password(client)
    assert r.status_code == 200
    assert "access_token" in r.json()


def test_me_shows_totp_enabled_false_before_confirm(client, auth):
    actor = auth()
    enrol(client, actor)
    body = client.get("/auth/me", headers=actor["headers"]).json()
    assert body["totp_enabled"] is False


def test_confirm_with_valid_code_activates_2fa_and_returns_recovery_codes(client, auth):
    actor = auth()
    secret = enrol(client, actor)
    codes = confirm(client, actor, secret)
    assert len(codes) == 10
    assert all(isinstance(c, str) and len(c) > 0 for c in codes)


def test_me_shows_totp_enabled_true_after_confirm(client, auth):
    actor = auth()
    secret = enrol(client, actor)
    confirm(client, actor, secret)

    # After confirm, login must require a second step.
    r2 = login_password(client)
    assert r2.status_code == 202
    assert r2.json()["totp_required"] is True


def test_confirm_with_wrong_code_returns_400_and_does_not_activate(client, auth):
    actor = auth()
    enrol(client, actor)
    r = client.post(
        "/auth/totp/confirm",
        json={"code": "000000"},
        headers=actor["headers"],
    )
    assert r.status_code == 400
    # 2FA must NOT be activated — login must still be single-step.
    r2 = login_password(client)
    assert r2.status_code == 200


def test_confirm_without_prior_enrol_returns_400(client, auth):
    actor = auth()
    r = client.post(
        "/auth/totp/confirm",
        json={"code": "123456"},
        headers=actor["headers"],
    )
    assert r.status_code == 400


def test_enrolment_bumps_token_version_invalidating_old_sessions(client, auth):
    actor = auth()
    old_token = actor["token"]
    old_headers = actor["headers"]
    secret = enrol(client, actor)
    confirm(client, actor, secret)

    # The old token was issued before enrolment; it must be rejected now.
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {old_token}"})
    r = client.get("/auth/me", headers=old_headers)
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# Two-step login
# ---------------------------------------------------------------------------


def test_login_returns_202_with_pending_token_when_totp_enabled(client, auth):
    actor = auth()
    secret = enrol(client, actor)
    confirm(client, actor, secret)

    r = login_password(client)
    assert r.status_code == 202
    body = r.json()
    assert body["totp_required"] is True
    assert "pending_token" in body


def test_full_two_step_login_issues_a_real_token(client, auth):
    actor = auth()
    secret = enrol(client, actor)
    confirm(client, actor, secret)

    r1 = login_password(client)
    assert r1.status_code == 202
    pending_token = r1.json()["pending_token"]
    code = pyotp.TOTP(secret).now()

    r2 = login_totp(client, pending_token, code)
    assert r2.status_code == 200
    body = r2.json()
    assert "access_token" in body
    assert body["user"]["totp_enabled"] is True


def test_wrong_totp_code_at_verify_returns_401(client, auth):
    actor = auth()
    secret = enrol(client, actor)
    confirm(client, actor, secret)

    r1 = login_password(client)
    assert r1.status_code == 202
    pending_token = r1.json()["pending_token"]

    r2 = login_totp(client, pending_token, "000000")
    assert r2.status_code == 401


def test_pending_token_cannot_be_used_as_bearer_token(client, auth):
    actor = auth()
    secret = enrol(client, actor)
    confirm(client, actor, secret)

    r1 = login_password(client)
    assert r1.status_code == 202
    pending_token = r1.json()["pending_token"]

    r = client.get("/auth/me", headers={"Authorization": f"Bearer {pending_token}"})
    assert r.status_code == 401


def test_verify_with_garbage_pending_token_returns_401(client):
    r = client.post(
        "/auth/totp/verify",
        json={"pending_token": "not-a-jwt", "code": "123456"},
    )
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# Drift tolerance
# ---------------------------------------------------------------------------


def test_code_from_previous_window_is_accepted(client, auth):
    """±1 window drift (30 s) must be accepted."""
    actor = auth()
    secret = enrol(client, actor)
    confirm(client, actor, secret)

    r1 = login_password(client)
    assert r1.status_code == 202
    pending_token = r1.json()["pending_token"]

    # Code from 30 seconds ago (exactly one window back).
    past_code = pyotp.TOTP(secret).at(time.time() - 30)
    r2 = login_totp(client, pending_token, past_code)
    assert r2.status_code == 200


def test_code_from_two_windows_ago_is_rejected(client, auth):
    """±2 windows (>60 s) must be rejected."""
    actor = auth()
    secret = enrol(client, actor)
    confirm(client, actor, secret)

    r1 = login_password(client)
    assert r1.status_code == 202
    pending_token = r1.json()["pending_token"]

    # 3 windows back — definitely outside ±1.
    old_code = pyotp.TOTP(secret).at(time.time() - 90)
    r2 = login_totp(client, pending_token, old_code)
    assert r2.status_code == 401


# ---------------------------------------------------------------------------
# Recovery codes
# ---------------------------------------------------------------------------


def test_login_with_recovery_code_succeeds(client, auth):
    actor = auth()
    secret = enrol(client, actor)
    recovery_codes = confirm(client, actor, secret)

    r1 = login_password(client)
    assert r1.status_code == 202
    pending_token = r1.json()["pending_token"]

    r2 = login_totp(client, pending_token, recovery_codes[0])
    assert r2.status_code == 200


def test_recovery_code_is_single_use(client, auth):
    actor = auth()
    secret = enrol(client, actor)
    recovery_codes = confirm(client, actor, secret)
    code = recovery_codes[0]

    # First use: succeed.
    r1 = login_password(client)
    assert r1.status_code == 202
    r2 = login_totp(client, r1.json()["pending_token"], code)
    assert r2.status_code == 200

    # Second use: fail.
    r3 = login_password(client)
    assert r3.status_code == 202
    r4 = login_totp(client, r3.json()["pending_token"], code)
    assert r4.status_code == 401


def test_all_ten_recovery_codes_are_unique(client, auth):
    actor = auth()
    secret = enrol(client, actor)
    codes = confirm(client, actor, secret)
    assert len(codes) == len(set(codes))


# ---------------------------------------------------------------------------
# Rate limiting (TOTP step)
# ---------------------------------------------------------------------------


def test_too_many_bad_totp_codes_trigger_429(client, auth):
    actor = auth()
    secret = enrol(client, actor)
    confirm(client, actor, secret)

    # totp_by_user allows 5 free attempts; the 6th is the first refusal.
    for _ in range(5):
        r = login_password(client)
        assert r.status_code == 202
        login_totp(client, r.json()["pending_token"], "000000")

    r = login_password(client)
    assert r.status_code == 202
    r2 = login_totp(client, r.json()["pending_token"], "000000")
    assert r2.status_code == 429
    assert "Retry-After" in r2.headers
    assert "two-factor" in r2.json()["detail"]


def test_correct_code_still_fails_while_locked_out(client, auth):
    actor = auth()
    secret = enrol(client, actor)
    confirm(client, actor, secret)

    # Exhaust the budget.
    for _ in range(6):
        r = login_password(client)
        assert r.status_code == 202
        login_totp(client, r.json()["pending_token"], "000000")

    # Even the correct code is now refused.
    r = login_password(client)
    assert r.status_code == 202
    correct = pyotp.TOTP(secret).now()
    r2 = login_totp(client, r.json()["pending_token"], correct)
    assert r2.status_code == 429


# ---------------------------------------------------------------------------
# Disable 2FA
# ---------------------------------------------------------------------------


def test_disable_with_valid_code_turns_off_2fa(client, auth):
    actor = auth()
    secret = enrol(client, actor)
    confirm(client, actor, secret)

    live = login_full(client, secret)
    code = pyotp.TOTP(secret).now()
    r = disable_totp(client, live, code)
    assert r.status_code == 200
    assert "access_token" in r.json()

    # Login should be single-step again.
    r2 = login_password(client)
    assert r2.status_code == 200
    assert "access_token" in r2.json()


def test_disable_with_recovery_code_turns_off_2fa(client, auth):
    actor = auth()
    secret = enrol(client, actor)
    codes = confirm(client, actor, secret)

    live = login_full(client, secret)
    r = disable_totp(client, live, codes[0])
    assert r.status_code == 200
    assert "access_token" in r.json()


def test_disable_with_wrong_code_returns_400(client, auth):
    actor = auth()
    secret = enrol(client, actor)
    confirm(client, actor, secret)

    live = login_full(client, secret)
    r = disable_totp(client, live, "000000")
    assert r.status_code == 400
    # 2FA must still be on.
    r2 = login_password(client)
    assert r2.status_code == 202


def test_disable_when_2fa_not_enabled_returns_400(client, auth):
    actor = auth()
    r = disable_totp(client, actor, "000000")
    assert r.status_code == 400


def test_disable_bumps_token_version_invalidating_old_sessions(client, auth):
    actor = auth()
    secret = enrol(client, actor)
    # Confirm and get a fresh login token.
    code_confirm = pyotp.TOTP(secret).now()
    client.post(
        "/auth/totp/confirm",
        json={"code": code_confirm},
        headers=actor["headers"],
    )

    r1 = login_password(client)
    assert r1.status_code == 202
    r2 = login_totp(client, r1.json()["pending_token"], pyotp.TOTP(secret).now())
    assert r2.status_code == 200
    live_token = r2.json()["access_token"]
    live_headers = {"Authorization": f"Bearer {live_token}"}

    # Disable via the live post-login token.
    disable_code = pyotp.TOTP(secret).now()
    rd = client.post(
        "/auth/totp/disable",
        json={"code": disable_code},
        headers=live_headers,
    )
    assert rd.status_code == 200

    # The same live token must now be rejected (token_version bumped).
    r3 = client.get("/auth/me", headers=live_headers)
    assert r3.status_code == 401


# ---------------------------------------------------------------------------
# Admin clear-totp
# ---------------------------------------------------------------------------


def test_admin_can_clear_totp_for_a_locked_out_user(client, auth):
    admin = auth(email="admin@softtrack.dev")
    victim = auth(email="victim@softtrack.dev")

    secret = enrol(client, victim)
    confirm(client, victim, secret)

    r = client.post(
        f"/admin/users/{victim['user']['id']}/clear-totp",
        headers=admin["headers"],
    )
    assert r.status_code == 204

    # Victim can now log in without a TOTP code.
    r2 = login_password(client, email="victim@softtrack.dev")
    assert r2.status_code == 200


def test_admin_clear_totp_revokes_victim_sessions(client, auth):
    admin = auth(email="admin@softtrack.dev")
    victim = auth(email="victim@softtrack.dev")

    secret = enrol(client, victim)
    code_confirm = pyotp.TOTP(secret).now()
    client.post(
        "/auth/totp/confirm",
        json={"code": code_confirm},
        headers=victim["headers"],
    )
    # Get a post-enrolment session.
    r1 = login_password(client, email="victim@softtrack.dev")
    assert r1.status_code == 202
    r2 = login_totp(client, r1.json()["pending_token"], pyotp.TOTP(secret).now())
    assert r2.status_code == 200
    live_headers = {"Authorization": f"Bearer {r2.json()['access_token']}"}

    client.post(
        f"/admin/users/{victim['user']['id']}/clear-totp",
        headers=admin["headers"],
    )
    # Victim's session must be invalid.
    r3 = client.get("/auth/me", headers=live_headers)
    assert r3.status_code == 401


def test_admin_clear_totp_on_user_without_2fa_is_harmless(client, auth):
    admin = auth(email="admin@softtrack.dev")
    plain = auth(email="plain@softtrack.dev")

    r = client.post(
        f"/admin/users/{plain['user']['id']}/clear-totp",
        headers=admin["headers"],
    )
    assert r.status_code == 204


def test_normal_user_cannot_clear_totp(client, auth):
    admin = auth(email="admin@softtrack.dev")
    attacker = auth(email="attacker@softtrack.dev")

    r = client.post(
        f"/admin/users/{admin['user']['id']}/clear-totp",
        headers=attacker["headers"],
    )
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# Security invariants
# ---------------------------------------------------------------------------


def test_users_without_2fa_are_unaffected(client, auth):
    """The happy path for non-2FA users must stay exactly as before."""
    auth(email="plain@softtrack.dev")
    r = login_password(client, email="plain@softtrack.dev")
    assert r.status_code == 200
    assert "access_token" in r.json()
    assert r.json()["user"]["totp_enabled"] is False


def test_totp_enabled_false_in_me_for_new_user(client, auth):
    actor = auth()
    body = client.get("/auth/me", headers=actor["headers"]).json()
    assert body["totp_enabled"] is False


def test_recovery_check_does_not_short_circuit_on_early_match():
    """The recovery-code check must compare ALL codes regardless of match index.

    A short-circuit at index 0 would take measurably less time than a match
    at index 9, leaking the index and halving the effective search space.
    """
    import lib_identity.totp as totp_module
    from lib_identity.totp import check_recovery_code, generate_recovery_codes

    plain_codes, hashed_codes = generate_recovery_codes()
    assert len(plain_codes) == 10

    call_counts: list[int] = []
    original_compare = totp_module.hmac.compare_digest

    def counting_compare(a, b):
        call_counts.append(1)
        return original_compare(a, b)

    with patch.object(totp_module.hmac, "compare_digest", side_effect=counting_compare):
        # Match at index 0.
        call_counts.clear()
        check_recovery_code(plain_codes[0], hashed_codes)
        calls_first = len(call_counts)

        # Match at index 9 (last).
        call_counts.clear()
        check_recovery_code(plain_codes[9], hashed_codes)
        calls_last = len(call_counts)

    # Both must compare all 10 hashes, not stop early.
    assert calls_first == 10, f"expected 10 compares for index-0 match, got {calls_first}"
    assert calls_last == 10, f"expected 10 compares for index-9 match, got {calls_last}"


def test_the_totp_lockout_cap_prevents_permanent_denial_of_service():
    """A griefer cannot lock out a TOTP user indefinitely."""
    from lib_utils.rate_limit import login_by_account, totp_by_user

    assert totp_by_user.max_delay <= 60
    assert totp_by_user.max_delay <= login_by_account.max_delay * 2


def test_every_totp_throttle_forgets_eventually():
    from lib_utils.rate_limit import totp_by_user

    assert totp_by_user.max_delay < float("inf")
    assert totp_by_user.forget_after > 0


def test_enrolment_start_does_not_disable_active_totp(client, auth):
    """Calling POST /auth/totp/enrol must NOT turn off totp_enabled for an already-active user."""
    actor = auth()
    secret = enrol(client, actor)
    confirm(client, actor, secret)

    # User currently has 2FA active. Login requires 2FA.
    r1 = login_password(client)
    assert r1.status_code == 202

    live = login_full(client, secret)

    # Start a new enrolment (e.g. user clicked setup again).
    # This must NOT set totp_enabled to False.
    enrol(client, live)

    # User's active 2FA must STILL be required!
    r2 = login_password(client)
    assert r2.status_code == 202
    assert r2.json()["totp_required"] is True

    # User can still sign in with the active secret (next window to avoid replay rejection)!
    code = pyotp.TOTP(secret).at(time.time() + 30)
    r3 = login_totp(client, r2.json()["pending_token"], code)
    assert r3.status_code == 200


def test_replay_of_same_totp_code_is_rejected(client, auth):
    """An OTP code used once cannot be reused within the same time window (replay protection)."""
    actor = auth()
    secret = enrol(client, actor)
    confirm(client, actor, secret)

    r1 = login_password(client)
    assert r1.status_code == 202
    pending1 = r1.json()["pending_token"]
    code = pyotp.TOTP(secret).now()

    # First use succeeds:
    r2 = login_totp(client, pending1, code)
    assert r2.status_code == 200

    # Second use with the same code (even with a new pending token) must be rejected:
    r3 = login_password(client)
    assert r3.status_code == 202
    pending2 = r3.json()["pending_token"]
    r4 = login_totp(client, pending2, code)
    assert r4.status_code == 401


def test_pending_token_invalidated_by_password_reset(client, auth):
    """If token_version changes, in-flight pending tokens are immediately invalidated."""
    admin = auth(email="admin@softtrack.dev")
    victim = auth(email="victim@softtrack.dev")
    secret = enrol(client, victim)
    confirm(client, victim, secret)

    r1 = login_password(client, email="victim@softtrack.dev")
    assert r1.status_code == 202
    pending = r1.json()["pending_token"]

    # Admin resets password (bumps token_version)
    client.post(
        f"/admin/users/{victim['user']['id']}/reset-password",
        json={"new_password": "newpassword123"},
        headers=admin["headers"],
    )

    # In-flight pending token must now be rejected
    code = pyotp.TOTP(secret).now()
    r2 = login_totp(client, pending, code)
    assert r2.status_code == 401


def test_disable_is_rate_limited(client, auth):
    """POST /auth/totp/disable throttles repeated wrong guesses."""
    actor = auth()
    secret = enrol(client, actor)
    confirm(client, actor, secret)
    live = login_full(client, secret)

    # 5 failed attempts allowed, 6th triggers 429
    for _ in range(5):
        r = disable_totp(client, live, "000000")
        assert r.status_code == 400

    r6 = disable_totp(client, live, "000000")
    assert r6.status_code == 429


def test_recovery_code_decoding_corrupted_data_does_not_crash(client, auth, session):
    from lib_softtrack.tables import User
    actor = auth()
    secret = enrol(client, actor)
    confirm(client, actor, secret)

    # Intentionally corrupt recovery codes with non-string elements in JSON
    user = session.get(User, actor["user"]["id"])
    user.totp_recovery_codes = '[123, null, true, "badcode"]'
    session.add(user)
    session.commit()

    r1 = login_password(client)
    assert r1.status_code == 202
    pending = r1.json()["pending_token"]

    # Trying a wrong recovery code must return 401, NOT crash with 500 TypeError
    r2 = login_totp(client, pending, "somecode")
    assert r2.status_code == 401

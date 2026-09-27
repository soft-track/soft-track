"""Tests for TOTP two-factor authentication.

Security edges that must stay covered:
- Lockout: 6 bad TOTP codes → 429; correct code still fails while locked
- Drift: ±1 window accepted; ±2 rejected
- Replay: a code accepted once is refused everywhere after -- sign-in, confirm
  and disable all spend the step they match
- Recovery codes: single-use, hashed; same code rejected on reuse
- token_version: enrolment and disable both bump it → old sessions rejected
- Pending token: cannot be used as a bearer token; expires in 5 minutes
- Enrolment: refused while 2FA is on; confirm needs a setup in progress
- Timing: the recovery-code path does not leak match index via early return
- Admin clear: no TOTP code needed; invalidates sessions; unconditional
- An unreadable secret is reported as such, never as a wrong code

The server's clock is replaced by `clock`, which every helper that submits a
code moves on by one 30-second step first. Without that, a test that turns
two-factor on and then signs in within the same step would be presenting the
same code twice -- which is exactly what replay protection refuses.
"""

from unittest.mock import patch

import pyotp
import pytest

import lib_identity.totp as totp_module

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_DEFAULT_EMAIL = "demo@softtrack.dev"
_DEFAULT_PASS = "password123"


class Clock:
    """The time the server reads, moved on by hand."""

    def __init__(self, start: float):
        self.now = start

    def __call__(self) -> float:
        return self.now

    def tick(self, seconds: float = 30) -> None:
        self.now += seconds

    def code(self, secret: str, offset: float = 0) -> str:
        """A code for `secret` at `offset` seconds from the server's now."""
        return pyotp.TOTP(secret).at(self.now + offset)

    def fresh_code(self, secret: str) -> str:
        """A code from a step no earlier code has come from."""
        self.tick()
        return self.code(secret)


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    # Aligned to the start of a step, so ±30s is always exactly one step.
    c = Clock(1_800_000_000 - 1_800_000_000 % 30)
    monkeypatch.setattr(totp_module, "_now", c)
    return c


def enrol(client, actor):
    """Start enrolment and return the TOTP secret (= the manual_key)."""
    r = client.post("/auth/totp/enrol", headers=actor["headers"])
    assert r.status_code == 200, r.text
    return r.json()["manual_key"]


def confirm(client, clock, actor, secret):
    """Confirm enrolment with a valid code and return the recovery codes.

    The actor's headers are swapped for the fresh token, since confirming
    signs every other session out.
    """
    r = client.post(
        "/auth/totp/confirm",
        json={"code": clock.fresh_code(secret)},
        headers=actor["headers"],
    )
    assert r.status_code == 200, r.text
    actor["headers"] = {"Authorization": f"Bearer {r.json()['token']['access_token']}"}
    return r.json()["recovery_codes"]


def enable(client, clock, actor):
    """Turn two-factor on for `actor`. Returns `(secret, recovery_codes)`."""
    secret = enrol(client, actor)
    return secret, confirm(client, clock, actor, secret)


def login_password(client, email=_DEFAULT_EMAIL, password=_DEFAULT_PASS):
    return client.post("/auth/login", data={"username": email, "password": password})


def login_totp(client, pending_token, code):
    return client.post(
        "/auth/totp/verify",
        json={"pending_token": pending_token, "code": code},
    )


def pending(client, email=_DEFAULT_EMAIL):
    r = login_password(client, email)
    assert r.status_code == 202, r.text
    return r.json()["pending_token"]


def disable_totp(client, actor, code):
    return client.post(
        "/auth/totp/disable",
        json={"code": code},
        headers=actor["headers"],
    )


def login_full(client, clock, secret, email=_DEFAULT_EMAIL):
    """Complete a full two-step login and return a fresh session with headers."""
    r = login_totp(client, pending(client, email), clock.fresh_code(secret))
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    return {
        "user": r.json()["user"],
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


def test_confirm_with_valid_code_activates_2fa_and_returns_recovery_codes(
    client, clock, auth
):
    actor = auth()
    _, codes = enable(client, clock, actor)
    assert len(codes) == 10
    assert all(isinstance(c, str) and len(c) > 0 for c in codes)
    body = client.get("/auth/me", headers=actor["headers"]).json()
    assert body["totp_enabled"] is True


def test_me_shows_totp_enabled_true_after_confirm(client, clock, auth):
    actor = auth()
    enable(client, clock, actor)

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
    assert r.json()["code"] == "totp_code_invalid"
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
    assert r.json()["code"] == "totp_not_enrolling"


def test_confirm_on_an_enrolled_account_does_not_rotate_recovery_codes(
    client, clock, auth
):
    """With no setup in progress, a live code must not regenerate the sheet
    the user saved, nor sign out every other device."""
    actor = auth()
    secret, codes = enable(client, clock, actor)
    other_device = login_full(client, clock, secret)

    r = client.post(
        "/auth/totp/confirm",
        json={"code": clock.fresh_code(secret)},
        headers=actor["headers"],
    )
    assert r.status_code == 400
    assert r.json()["code"] == "totp_not_enrolling"

    # The saved recovery codes still work, and the other device is still in.
    assert client.get("/auth/me", headers=other_device["headers"]).status_code == 200
    assert login_totp(client, pending(client), codes[0]).status_code == 200


def test_enrolment_bumps_token_version_invalidating_old_sessions(client, clock, auth):
    actor = auth()
    old_headers = actor["headers"]
    enable(client, clock, actor)

    # The old token was issued before enrolment; it must be rejected now.
    assert client.get("/auth/me", headers=old_headers).status_code == 401
    # The token confirm handed back keeps this tab signed in.
    assert client.get("/auth/me", headers=actor["headers"]).status_code == 200


def test_enrolment_is_refused_while_2fa_is_on(client, clock, auth):
    """Swapping the live secret without its code would let a stolen session
    install its own authenticator and then disable 2FA with it."""
    actor = auth()
    secret, _ = enable(client, clock, actor)

    r = client.post("/auth/totp/enrol", headers=actor["headers"])
    assert r.status_code == 400
    assert r.json()["code"] == "totp_already_enabled"

    # 2FA is still required, with the original secret.
    login_full(client, clock, secret)


def test_setting_up_again_after_turning_it_off_works(client, clock, auth):
    """Moving to a new phone: off with the old one, on with the new one."""
    actor = auth()
    old_secret, _ = enable(client, clock, actor)
    r = disable_totp(client, actor, clock.fresh_code(old_secret))
    assert r.status_code == 200
    actor["headers"] = {"Authorization": f"Bearer {r.json()['access_token']}"}

    new_secret, _ = enable(client, clock, actor)
    assert new_secret != old_secret
    r = login_totp(client, pending(client), clock.fresh_code(old_secret))
    assert r.status_code == 401
    login_full(client, clock, new_secret)


# ---------------------------------------------------------------------------
# Two-step login
# ---------------------------------------------------------------------------


def test_login_returns_202_with_pending_token_when_totp_enabled(client, clock, auth):
    actor = auth()
    enable(client, clock, actor)

    r = login_password(client)
    assert r.status_code == 202
    body = r.json()
    assert body["totp_required"] is True
    assert "pending_token" in body
    assert "access_token" not in body


def test_full_two_step_login_issues_a_real_token(client, clock, auth):
    actor = auth()
    secret, _ = enable(client, clock, actor)

    r2 = login_totp(client, pending(client), clock.fresh_code(secret))
    assert r2.status_code == 200
    body = r2.json()
    assert "access_token" in body
    assert body["user"]["totp_enabled"] is True
    me = client.get(
        "/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}
    )
    assert me.status_code == 200


def test_wrong_totp_code_at_verify_returns_401(client, clock, auth):
    actor = auth()
    enable(client, clock, actor)

    r2 = login_totp(client, pending(client), "000000")
    assert r2.status_code == 401
    assert r2.json()["code"] == "totp_code_invalid"


def test_pending_token_cannot_be_used_as_bearer_token(client, clock, auth):
    actor = auth()
    enable(client, clock, actor)

    r = client.get("/auth/me", headers={"Authorization": f"Bearer {pending(client)}"})
    assert r.status_code == 401


def test_an_access_token_cannot_be_used_as_a_pending_token(client, clock, auth):
    """The reverse: a session, which skipped nothing, is not a way into verify."""
    actor = auth()
    secret, _ = enable(client, clock, actor)
    session_token = actor["headers"]["Authorization"].removeprefix("Bearer ")

    r = login_totp(client, session_token, clock.fresh_code(secret))
    assert r.status_code == 401
    assert r.json()["code"] == "totp_session_expired"


def test_verify_with_garbage_pending_token_returns_401(client):
    r = client.post(
        "/auth/totp/verify",
        json={"pending_token": "not-a-jwt", "code": "123456"},
    )
    assert r.status_code == 401
    assert r.json()["code"] == "totp_session_expired"


def test_a_pending_token_lives_five_minutes(client, clock, auth):
    from datetime import datetime, timezone

    from jose import jwt

    actor = auth()
    enable(client, clock, actor)

    claims = jwt.get_unverified_claims(pending(client))
    assert claims["typ"] == "totp_pending"
    remaining = claims["exp"] - datetime.now(timezone.utc).timestamp()
    assert 290 < remaining <= 300


def test_an_expired_pending_token_is_refused(client, clock, auth):
    from datetime import datetime, timedelta, timezone

    from jose import jwt

    from web import settings

    actor = auth()
    secret, _ = enable(client, clock, actor)
    expired = jwt.encode(
        {
            "sub": str(actor["user"]["id"]),
            "ver": 1,
            "typ": "totp_pending",
            "exp": datetime.now(timezone.utc) - timedelta(seconds=1),
        },
        settings.secret_key,
        algorithm=settings.algorithm,
    )
    r = login_totp(client, expired, clock.fresh_code(secret))
    assert r.status_code == 401
    assert r.json()["code"] == "totp_session_expired"


# ---------------------------------------------------------------------------
# Drift tolerance
# ---------------------------------------------------------------------------


def test_code_from_previous_window_is_accepted(client, clock, auth):
    """±1 window drift (30 s) must be accepted."""
    actor = auth()
    secret, _ = enable(client, clock, actor)
    token = pending(client)

    # Two steps on from the code that confirmed, then one back: a step that
    # has not been used, one window behind the server.
    clock.tick(60)
    r2 = login_totp(client, token, clock.code(secret, -30))
    assert r2.status_code == 200


def test_code_from_next_window_is_accepted(client, clock, auth):
    actor = auth()
    secret, _ = enable(client, clock, actor)

    r2 = login_totp(client, pending(client), clock.code(secret, +30))
    assert r2.status_code == 200


def test_code_from_two_windows_ago_is_rejected(client, clock, auth):
    """±2 windows (>60 s) must be rejected."""
    actor = auth()
    secret, _ = enable(client, clock, actor)
    token = pending(client)

    clock.tick(120)
    r2 = login_totp(client, token, clock.code(secret, -60))
    assert r2.status_code == 401


def test_code_from_two_windows_ahead_is_rejected(client, clock, auth):
    actor = auth()
    secret, _ = enable(client, clock, actor)

    r2 = login_totp(client, pending(client), clock.code(secret, +60))
    assert r2.status_code == 401


# ---------------------------------------------------------------------------
# Replay
# ---------------------------------------------------------------------------


def test_replay_of_same_totp_code_is_rejected(client, clock, auth):
    """An OTP code used once cannot be reused within the same time window."""
    actor = auth()
    secret, _ = enable(client, clock, actor)
    clock.tick()
    code = clock.code(secret)

    assert login_totp(client, pending(client), code).status_code == 200
    # Same code, new pending token: refused.
    r = login_totp(client, pending(client), code)
    assert r.status_code == 401
    assert r.json()["code"] == "totp_code_invalid"


def test_the_code_that_turned_2fa_on_cannot_sign_in(client, clock, auth):
    actor = auth()
    secret = enrol(client, actor)
    clock.tick()
    code = clock.code(secret)
    r = client.post("/auth/totp/confirm", json={"code": code}, headers=actor["headers"])
    assert r.status_code == 200

    assert login_totp(client, pending(client), code).status_code == 401


def test_the_code_that_signed_in_cannot_turn_2fa_off(client, clock, auth):
    actor = auth()
    secret, _ = enable(client, clock, actor)
    clock.tick()
    code = clock.code(secret)
    live = login_full_with(client, code)

    r = disable_totp(client, live, code)
    assert r.status_code == 400
    assert r.json()["code"] == "totp_code_invalid"


def test_an_earlier_step_is_refused_after_a_later_one(client, clock, auth):
    """Accepting step N rules out N-1 too, even though it is inside the drift."""
    actor = auth()
    secret, _ = enable(client, clock, actor)
    clock.tick(60)

    assert (
        login_totp(client, pending(client), clock.code(secret, +30)).status_code == 200
    )
    assert login_totp(client, pending(client), clock.code(secret)).status_code == 401


def login_full_with(client, code):
    r = login_totp(client, pending(client), code)
    assert r.status_code == 200, r.text
    return {"headers": {"Authorization": f"Bearer {r.json()['access_token']}"}}


# ---------------------------------------------------------------------------
# Recovery codes
# ---------------------------------------------------------------------------


def test_login_with_recovery_code_succeeds(client, clock, auth):
    actor = auth()
    _, recovery_codes = enable(client, clock, actor)

    r2 = login_totp(client, pending(client), recovery_codes[0])
    assert r2.status_code == 200


def test_recovery_code_is_single_use(client, clock, auth):
    actor = auth()
    _, recovery_codes = enable(client, clock, actor)
    code = recovery_codes[0]

    assert login_totp(client, pending(client), code).status_code == 200
    assert login_totp(client, pending(client), code).status_code == 401
    # The others are untouched.
    assert login_totp(client, pending(client), recovery_codes[1]).status_code == 200


def test_all_ten_recovery_codes_are_unique(client, clock, auth):
    actor = auth()
    _, codes = enable(client, clock, actor)
    assert len(codes) == len(set(codes))


# ---------------------------------------------------------------------------
# Rate limiting (TOTP step)
# ---------------------------------------------------------------------------


def test_too_many_bad_totp_codes_trigger_429(client, clock, auth):
    actor = auth()
    enable(client, clock, actor)

    # totp_by_user allows 5 free attempts; the 6th is the first refusal.
    for _ in range(5):
        login_totp(client, pending(client), "000000")

    r2 = login_totp(client, pending(client), "000000")
    assert r2.status_code == 429
    assert "Retry-After" in r2.headers
    assert "two-factor" in r2.json()["detail"]


def test_correct_code_still_fails_while_locked_out(client, clock, auth):
    actor = auth()
    secret, _ = enable(client, clock, actor)

    # Exhaust the budget.
    for _ in range(6):
        login_totp(client, pending(client), "000000")

    # Even the correct code is now refused.
    r2 = login_totp(client, pending(client), clock.fresh_code(secret))
    assert r2.status_code == 429


def test_an_expired_sign_in_is_not_charged_as_a_guess(client):
    """A stale pending token is not a code guess; counting it would lock
    somebody out for letting five minutes pass."""
    for _ in range(25):
        r = login_totp(client, "not-a-jwt", "000000")
        assert r.status_code == 401


# ---------------------------------------------------------------------------
# Disable 2FA
# ---------------------------------------------------------------------------


def test_disable_with_valid_code_turns_off_2fa(client, clock, auth):
    actor = auth()
    secret, _ = enable(client, clock, actor)

    live = login_full(client, clock, secret)
    r = disable_totp(client, live, clock.fresh_code(secret))
    assert r.status_code == 200
    assert "access_token" in r.json()
    assert r.json()["user"]["totp_enabled"] is False

    # Login should be single-step again.
    r2 = login_password(client)
    assert r2.status_code == 200
    assert "access_token" in r2.json()


def test_disable_with_recovery_code_turns_off_2fa(client, clock, auth):
    actor = auth()
    secret, codes = enable(client, clock, actor)

    live = login_full(client, clock, secret)
    r = disable_totp(client, live, codes[0])
    assert r.status_code == 200
    assert "access_token" in r.json()


def test_disable_with_wrong_code_returns_400(client, clock, auth):
    actor = auth()
    secret, _ = enable(client, clock, actor)

    live = login_full(client, clock, secret)
    r = disable_totp(client, live, "000000")
    assert r.status_code == 400
    assert r.json()["code"] == "totp_code_invalid"
    # 2FA must still be on.
    assert login_password(client).status_code == 202


def test_disable_when_2fa_not_enabled_returns_400(client, auth):
    actor = auth()
    r = disable_totp(client, actor, "000000")
    assert r.status_code == 400
    assert r.json()["code"] == "totp_not_enabled"


def test_disable_bumps_token_version_invalidating_old_sessions(client, clock, auth):
    actor = auth()
    secret, _ = enable(client, clock, actor)
    live = login_full(client, clock, secret)

    rd = disable_totp(client, live, clock.fresh_code(secret))
    assert rd.status_code == 200

    # The same live token must now be rejected (token_version bumped)...
    assert client.get("/auth/me", headers=live["headers"]).status_code == 401
    # ...and the one disable handed back keeps this tab signed in.
    fresh = {"Authorization": f"Bearer {rd.json()['access_token']}"}
    assert client.get("/auth/me", headers=fresh).status_code == 200


def test_disable_is_rate_limited(client, clock, auth):
    """POST /auth/totp/disable throttles repeated wrong guesses."""
    actor = auth()
    secret, _ = enable(client, clock, actor)
    live = login_full(client, clock, secret)

    # 5 failed attempts allowed, 6th triggers 429
    for _ in range(5):
        r = disable_totp(client, live, "000000")
        assert r.status_code == 400

    r6 = disable_totp(client, live, "000000")
    assert r6.status_code == 429


# ---------------------------------------------------------------------------
# Admin clear-totp
# ---------------------------------------------------------------------------


def test_admin_can_clear_totp_for_a_locked_out_user(client, clock, auth):
    admin = auth(email="admin@softtrack.dev")
    victim = auth(email="victim@softtrack.dev")
    enable(client, clock, victim)

    r = client.post(
        f"/admin/users/{victim['user']['id']}/clear-totp",
        headers=admin["headers"],
    )
    assert r.status_code == 204

    # Victim can now log in without a TOTP code.
    r2 = login_password(client, email="victim@softtrack.dev")
    assert r2.status_code == 200


def test_admin_clear_totp_revokes_victim_sessions(client, clock, auth):
    admin = auth(email="admin@softtrack.dev")
    victim = auth(email="victim@softtrack.dev")
    secret, _ = enable(client, clock, victim)
    live = login_full(client, clock, secret, email="victim@softtrack.dev")

    client.post(
        f"/admin/users/{victim['user']['id']}/clear-totp",
        headers=admin["headers"],
    )
    # Victim's session must be invalid.
    assert client.get("/auth/me", headers=live["headers"]).status_code == 401


def test_admin_clear_totp_on_user_without_2fa_is_harmless(client, auth):
    admin = auth(email="admin@softtrack.dev")
    plain = auth(email="plain@softtrack.dev")

    r = client.post(
        f"/admin/users/{plain['user']['id']}/clear-totp",
        headers=admin["headers"],
    )
    assert r.status_code == 204
    assert login_password(client, email="plain@softtrack.dev").status_code == 200


def test_admin_clear_totp_clears_a_half_finished_setup(client, auth, session):
    from lib_softtrack.tables import User

    admin = auth(email="admin@softtrack.dev")
    victim = auth(email="victim@softtrack.dev")
    enrol(client, victim)

    r = client.post(
        f"/admin/users/{victim['user']['id']}/clear-totp",
        headers=admin["headers"],
    )
    assert r.status_code == 204
    session.expire_all()
    assert session.get(User, victim["user"]["id"]).totp_pending_secret is None


def test_normal_user_cannot_clear_totp(client, auth):
    admin = auth(email="admin@softtrack.dev")
    attacker = auth(email="attacker@softtrack.dev")

    r = client.post(
        f"/admin/users/{admin['user']['id']}/clear-totp",
        headers=attacker["headers"],
    )
    assert r.status_code == 403


def test_the_admin_directory_shows_who_has_2fa(client, clock, auth):
    admin = auth(email="admin@softtrack.dev")
    victim = auth(email="victim@softtrack.dev")
    enable(client, clock, victim)

    rows = client.get("/admin/users", headers=admin["headers"]).json()["items"]
    by_email = {row["email"]: row for row in rows}
    assert by_email["victim@softtrack.dev"]["totp_enabled"] is True
    assert by_email["admin@softtrack.dev"]["totp_enabled"] is False


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


def test_the_secret_is_not_stored_in_the_clear(client, clock, auth, session):
    from lib_softtrack.tables import User

    actor = auth()
    secret, _ = enable(client, clock, actor)
    session.expire_all()
    stored = session.get(User, actor["user"]["id"]).totp_secret
    assert stored and secret not in stored


def test_an_unreadable_secret_is_reported_not_taken_for_a_wrong_code(
    client, clock, auth, session, caplog, monkeypatch
):
    """A rotated SECRET_KEY must not look like "wrong code" -- nor be charged
    against the throttle as though the user were guessing."""
    from lib_softtrack.tables import User

    # The migration tests run Alembic's fileConfig, which disables loggers
    # that already exist; this one has to be heard.
    monkeypatch.setattr(totp_module.logger, "disabled", False)
    actor = auth()
    secret, _ = enable(client, clock, actor)
    user = session.get(User, actor["user"]["id"])
    user.totp_secret = "gAAAAA-not-something-this-key-wrote"
    session.add(user)
    session.commit()

    for _ in range(8):
        r = login_totp(client, pending(client), clock.fresh_code(secret))
        assert r.status_code == 409
        assert r.json()["code"] == "totp_unavailable"
    assert "could not be decrypted" in caplog.text

    # The escape hatch still works.
    admin_headers = actor["headers"]  # the first account is the site admin
    r = client.post(
        f"/admin/users/{actor['user']['id']}/clear-totp", headers=admin_headers
    )
    assert r.status_code == 204
    assert login_password(client).status_code == 200


def test_recovery_check_does_not_short_circuit_on_early_match():
    """The recovery-code check must compare ALL codes regardless of match index.

    A short-circuit at index 0 would take measurably less time than a match
    at index 9, leaking the index and halving the effective search space.
    """
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
    assert (
        calls_first == 10
    ), f"expected 10 compares for index-0 match, got {calls_first}"
    assert calls_last == 10, f"expected 10 compares for index-9 match, got {calls_last}"


def test_the_totp_lockout_cap_prevents_permanent_denial_of_service():
    """A griefer cannot lock out a TOTP user indefinitely."""
    from lib_utils.rate_limit import login_by_account, totp_by_user

    assert totp_by_user.max_delay <= 60
    assert totp_by_user.max_delay <= login_by_account.max_delay * 2


def test_every_totp_throttle_forgets_eventually():
    from lib_utils.rate_limit import totp_by_address, totp_by_user

    for throttle in (totp_by_user, totp_by_address):
        assert throttle.max_delay < float("inf")
        assert throttle.forget_after > 0


def test_pending_token_invalidated_by_password_reset(client, clock, auth):
    """If token_version changes, in-flight pending tokens are immediately invalidated."""
    admin = auth(email="admin@softtrack.dev")
    victim = auth(email="victim@softtrack.dev")
    secret, _ = enable(client, clock, victim)
    token = pending(client, email="victim@softtrack.dev")

    # Admin resets password (bumps token_version)
    client.post(
        f"/admin/users/{victim['user']['id']}/reset-password",
        json={"new_password": "newpassword123"},
        headers=admin["headers"],
    )

    # In-flight pending token must now be rejected
    r2 = login_totp(client, token, clock.fresh_code(secret))
    assert r2.status_code == 401
    assert r2.json()["code"] == "totp_session_expired"


def test_recovery_code_decoding_corrupted_data_does_not_crash(
    client, clock, auth, session
):
    from lib_softtrack.tables import User

    actor = auth()
    enable(client, clock, actor)

    # Intentionally corrupt recovery codes with non-string elements in JSON
    user = session.get(User, actor["user"]["id"])
    user.totp_recovery_codes = '[123, null, true, "badcode"]'
    session.add(user)
    session.commit()

    # Trying a wrong recovery code must return 401, NOT crash with 500 TypeError
    r2 = login_totp(client, pending(client), "somecode")
    assert r2.status_code == 401

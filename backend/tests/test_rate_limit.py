"""Tests for the authentication throttle (issue #8).

The `Throttle` unit tests drive a fake clock rather than sleeping, so the
backoff schedule is checked exactly and the suite stays instant.
"""

import pytest

from lib_utils.rate_limit import (
    Throttle,
    login_by_account,
    login_by_address,
    registration_by_address,
)


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def make_throttle(clock, **overrides) -> Throttle:
    kwargs = dict(
        name="attempts",
        free_attempts=3,
        base_delay=2.0,
        max_delay=16.0,
        forget_after=100.0,
        clock=clock,
    )
    kwargs.update(overrides)
    return Throttle(**kwargs)


def lockout_seconds(throttle, key) -> float:
    """How long `key` is locked out for, or 0 if it is not."""
    try:
        throttle.raise_if_locked(key)
    except Exception as exc:  # HTTPException
        return float(exc.headers["Retry-After"])
    return 0.0


def test_the_free_attempts_cost_nothing():
    """Three attempts get through; the fourth is the one that is refused."""
    throttle = make_throttle(FakeClock())
    for _ in range(2):
        throttle.record_attempt("k")
    assert lockout_seconds(throttle, "k") == 0

    throttle.record_attempt("k")
    assert lockout_seconds(throttle, "k") > 0


def test_the_delay_doubles_and_then_stops_at_the_cap():
    clock = FakeClock()
    throttle = make_throttle(clock)
    for _ in range(2):
        throttle.record_attempt("k")

    # base_delay 2s, doubling from the third attempt, capped at 16s.
    for expected in [2, 4, 8, 16, 16, 16]:
        throttle.record_attempt("k")
        assert lockout_seconds(throttle, "k") == expected
        clock.advance(expected)


def test_the_lockout_ends_when_it_says_it_will():
    clock = FakeClock()
    throttle = make_throttle(clock)
    for _ in range(3):
        throttle.record_attempt("k")

    assert lockout_seconds(throttle, "k") == 2
    clock.advance(2)
    assert lockout_seconds(throttle, "k") == 0


def test_a_key_that_goes_quiet_is_forgotten():
    clock = FakeClock()
    throttle = make_throttle(clock)
    for _ in range(5):
        throttle.record_attempt("k")

    clock.advance(200)  # past forget_after, and past the 4s lockout
    throttle.record_attempt("k")
    assert lockout_seconds(throttle, "k") == 0, "yesterday's typos should not count"


def test_a_long_lockout_does_not_erase_itself():
    """`forget_after` must never expire a key that is still serving time."""
    clock = FakeClock()
    throttle = make_throttle(clock, max_delay=500.0, forget_after=10.0)
    for _ in range(8):
        throttle.record_attempt("k")

    clock.advance(50)  # well past forget_after, well inside the lockout
    assert lockout_seconds(throttle, "k") > 0


def test_keys_do_not_share_a_budget():
    throttle = make_throttle(FakeClock())
    for _ in range(6):
        throttle.record_attempt("noisy")
    assert lockout_seconds(throttle, "noisy") > 0
    assert lockout_seconds(throttle, "quiet") == 0


def test_success_clears_the_record():
    throttle = make_throttle(FakeClock())
    for _ in range(6):
        throttle.record_attempt("k")
    assert lockout_seconds(throttle, "k") > 0

    throttle.forgive("k")
    assert lockout_seconds(throttle, "k") == 0


def test_the_wait_is_worded_for_a_human_to_read():
    clock = FakeClock()
    throttle = make_throttle(clock, base_delay=1.0, max_delay=60.0)
    for _ in range(3):
        throttle.record_attempt("k")

    with pytest.raises(Exception) as one:
        throttle.raise_if_locked("k")
    assert "in 1 second." in one.value.detail

    throttle.record_attempt("k")
    with pytest.raises(Exception) as two:
        throttle.raise_if_locked("k")
    assert "in 2 seconds." in two.value.detail


def test_a_griefer_cannot_lock_someone_out_for_long():
    """The per-account cap bounds the damage a third party can do.

    Anyone who knows your address can fail sign-ins as you. That must cost
    them a brute-force budget without handing them a way to keep you out of
    your own account, so this delay is capped where the per-address one is not.
    """
    assert login_by_account.max_delay <= 60
    assert login_by_account.max_delay < login_by_address.max_delay


# --- through the API ---------------------------------------------------


def failed_login(client, email="demo@softtrack.dev", password="wrong"):
    return client.post("/auth/login", data={"username": email, "password": password})


def test_repeated_wrong_passwords_start_getting_429(client, auth):
    auth()

    # login_by_account allows five, so the sixth is the first refusal.
    for _ in range(5):
        assert failed_login(client).status_code == 401

    response = failed_login(client)
    assert response.status_code == 429
    assert int(response.headers["Retry-After"]) >= 1
    assert "sign-in" in response.json()["detail"]


def test_the_right_password_still_works_before_the_budget_runs_out(client, auth):
    auth()
    for _ in range(3):
        assert failed_login(client).status_code == 401

    response = client.post(
        "/auth/login",
        data={"username": "demo@softtrack.dev", "password": "password123"},
    )
    assert response.status_code == 200


def test_signing_in_clears_the_counter(client, auth):
    auth()
    for _ in range(4):
        failed_login(client)

    client.post(
        "/auth/login",
        data={"username": "demo@softtrack.dev", "password": "password123"},
    )

    # Back to a full budget: four more failures must not trip the limit.
    for _ in range(4):
        assert failed_login(client).status_code == 401


def test_spraying_many_addresses_still_trips_the_per_address_limit(client):
    """This is what the per-address throttle is for.

    One guess each against ten different addresses never spends any single
    account's budget, so the account throttle cannot see it. Enumerating who
    has an account here is exactly that shape of traffic.
    """
    for i in range(10):
        response = failed_login(client, email=f"nobody{i}@example.com")
        assert response.status_code == 401, f"attempt {i} should not be limited yet"

    assert failed_login(client, email="nobody10@example.com").status_code == 429


def test_registration_is_capped_per_address(client):
    for i in range(10):
        response = client.post(
            "/auth/register",
            json={
                "email": f"user{i}@example.com",
                "password": "password123",
                "full_name": "User",
            },
        )
        assert response.status_code == 200, response.text

    response = client.post(
        "/auth/register",
        json={
            "email": "one-too-many@example.com",
            "password": "password123",
            "full_name": "User",
        },
    )
    assert response.status_code == 429
    assert "registrations" in response.json()["detail"]


def test_an_unknown_address_costs_the_same_work_as_a_wrong_password(
    client, auth, monkeypatch
):
    """Guard the timing oracle by counting the bcrypt calls, not the clock.

    Timing assertions are flaky on shared CI runners. The invariant that
    actually matters is that both paths run one password verification, and
    that is exact.
    """
    import lib_identity.identity as identity

    calls = []
    real = identity.verify_password
    monkeypatch.setattr(
        identity,
        "verify_password",
        lambda plain, hashed: calls.append(hashed) or real(plain, hashed),
    )

    auth()

    failed_login(client, email="demo@softtrack.dev")
    known_user_calls = len(calls)
    calls.clear()

    failed_login(client, email="nobody@example.com")
    unknown_user_calls = len(calls)

    assert known_user_calls == 1
    assert (
        unknown_user_calls == 1
    ), "an unknown address must still pay for a bcrypt verify"


def test_the_two_failures_are_worded_identically(client, auth):
    auth()
    known = failed_login(client, email="demo@softtrack.dev")
    unknown = failed_login(client, email="nobody@example.com")

    assert known.status_code == unknown.status_code == 401
    assert known.json() == unknown.json()


@pytest.mark.parametrize(
    "throttle",
    [login_by_address, login_by_account, registration_by_address],
    ids=["login_by_address", "login_by_account", "registration_by_address"],
)
def test_every_throttle_forgets_eventually(throttle):
    """No throttle may lock a key out permanently."""
    assert throttle.max_delay < float("inf")
    assert throttle.forget_after > 0

"""Personal API tokens (issue #90).

A token is a credential in its own right, so most of these are about what it
must not do: survive revocation or deactivation, be stored readably, manage
other credentials, or be guessable at leisure.
"""

from datetime import timedelta

from sqlmodel import select

from lib_softtrack.tables import ApiToken, utcnow


def make_token(client, actor, name="CI", **fields):
    response = client.post(
        "/auth/me/tokens", json={"name": name, **fields}, headers=actor["headers"]
    )
    assert response.status_code == 200, response.text
    return response.json()


def bearer(secret):
    return {"Authorization": f"Bearer {secret}"}


def test_a_token_is_shown_once_and_acts_as_its_owner(client, team):
    created = make_token(client, team)
    secret = created["token"]
    assert secret.startswith("softtrack_") and len(secret) > 40

    me = client.get("/auth/me", headers=bearer(secret))
    assert me.status_code == 200
    assert me.json()["id"] == team["user"]["id"]

    # And it can do what its owner can.
    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": "Filed by a cron job"},
        headers=bearer(secret),
    )
    assert response.status_code == 200, response.text


def test_the_list_shows_a_hint_never_the_secret(client, team):
    secret = make_token(client, team)["token"]
    [listed] = client.get("/auth/me/tokens", headers=team["headers"]).json()
    assert listed["hint"] == f"softtrack_…{secret[-4:]}"
    assert "token" not in listed
    assert secret not in str(listed)


def test_only_a_hash_is_stored(client, team, session):
    secret = make_token(client, team)["token"]
    [row] = session.exec(select(ApiToken)).all()
    assert secret not in row.token_hash
    assert len(row.token_hash) == 64


def test_revoking_is_immediate(client, team):
    created = make_token(client, team)
    assert client.get("/auth/me", headers=bearer(created["token"])).status_code == 200
    response = client.delete(
        f"/auth/me/tokens/{created['id']}", headers=team["headers"]
    )
    assert response.status_code == 204
    assert client.get("/auth/me", headers=bearer(created["token"])).status_code == 401


def test_an_expired_token_stops_working(client, team, session):
    created = make_token(client, team, expires_in_days=30)
    assert created["expires_at"] is not None
    row = session.get(ApiToken, created["id"])
    row.expires_at = utcnow() - timedelta(seconds=1)
    session.add(row)
    session.commit()
    assert client.get("/auth/me", headers=bearer(created["token"])).status_code == 401


def test_last_used_is_recorded_but_not_on_every_request(client, team, session):
    created = make_token(client, team)
    assert created["last_used_at"] is None
    client.get("/auth/me", headers=bearer(created["token"]))
    session.expire_all()
    first = session.get(ApiToken, created["id"]).last_used_at
    assert first is not None

    client.get("/auth/me", headers=bearer(created["token"]))
    session.expire_all()
    assert session.get(ApiToken, created["id"]).last_used_at == first


def test_deactivating_the_account_kills_its_tokens_for_good(client, team, auth):
    member = auth(email="member@softtrack.dev", full_name="Member")
    secret = make_token(client, member)["token"]

    admin_patch = lambda active: client.patch(  # noqa: E731
        f"/admin/users/{member['user']['id']}",
        json={"is_active": active},
        headers=team["headers"],
    )
    assert admin_patch(False).status_code == 200
    assert client.get("/auth/me", headers=bearer(secret)).status_code == 401
    # Reactivating the account does not bring the token back.
    assert admin_patch(True).status_code == 200
    assert client.get("/auth/me", headers=bearer(secret)).status_code == 401


def test_a_token_cannot_manage_tokens_or_the_password(client, team):
    """A leaked token that could mint another would outlive its revocation;
    one that could set the password could take the account."""
    secret = make_token(client, team)["token"]
    for method, url, body in [
        ("get", "/auth/me/tokens", None),
        ("post", "/auth/me/tokens", {"name": "another"}),
        ("delete", "/auth/me/tokens/1", None),
        (
            "post",
            "/auth/me/password",
            {"current_password": "password123", "new_password": "taken-over"},
        ),
    ]:
        response = client.request(method, url, json=body, headers=bearer(secret))
        assert response.status_code == 403, (url, response.text)
        assert response.json()["code"] == "api_token_not_allowed"


def test_someone_elses_token_cannot_be_revoked(client, team, auth):
    other = auth(email="other@softtrack.dev", full_name="Other")
    theirs = make_token(client, other)
    response = client.delete(f"/auth/me/tokens/{theirs['id']}", headers=team["headers"])
    assert response.status_code == 404
    assert client.get("/auth/me", headers=bearer(theirs["token"])).status_code == 200


def test_guessing_tokens_is_throttled_like_guessing_passwords(client, team):
    statuses = [
        client.get("/auth/me", headers=bearer(f"softtrack_guess{n}")).status_code
        for n in range(11)
    ]
    assert statuses == [401] * 10 + [429]


def test_a_good_token_is_never_counted_as_a_failure(client, team):
    secret = make_token(client, team)["token"]
    for _ in range(30):
        assert client.get("/auth/me", headers=bearer(secret)).status_code == 200


def test_signing_out_everywhere_ends_sessions_not_tokens(client, team):
    """Deliberate: a token is for a script, which is not a session, and
    revoking it is its own gesture. The docs say so."""
    secret = make_token(client, team)["token"]
    client.post("/auth/me/sign-out-everywhere", headers=team["headers"])
    assert client.get("/auth/me", headers=bearer(secret)).status_code == 200


def test_an_expiry_out_of_range_is_refused(client, team):
    response = client.post(
        "/auth/me/tokens",
        json={"name": "Forever-ish", "expires_in_days": 5000},
        headers=team["headers"],
    )
    assert response.status_code == 422

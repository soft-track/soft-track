def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_register_returns_a_token_and_the_user(client, auth):
    actor = auth(email="new@softtrack.dev", full_name="New Person")
    assert actor["user"]["email"] == "new@softtrack.dev"
    assert actor["user"]["full_name"] == "New Person"
    assert actor["headers"]["Authorization"].startswith("Bearer ")


def test_register_rejects_a_duplicate_email(client, auth):
    auth(email="taken@softtrack.dev")
    response = client.post(
        "/auth/register",
        json={
            "email": "taken@softtrack.dev",
            "password": "password123",
            "full_name": "Someone Else",
        },
    )
    assert response.status_code == 400


def test_register_rejects_a_short_password(client):
    response = client.post(
        "/auth/register",
        json={"email": "x@softtrack.dev", "password": "short", "full_name": "X"},
    )
    assert response.status_code == 422


def test_login_succeeds_with_the_right_password(client, auth):
    auth(email="login@softtrack.dev")
    response = client.post(
        "/auth/login",
        data={"username": "login@softtrack.dev", "password": "password123"},
    )
    assert response.status_code == 200
    assert response.json()["token_type"] == "bearer"


def test_login_rejects_a_wrong_password(client, auth):
    auth(email="login@softtrack.dev")
    response = client.post(
        "/auth/login",
        data={"username": "login@softtrack.dev", "password": "wrong-password"},
    )
    assert response.status_code == 401


def test_login_rejects_an_unknown_email(client):
    response = client.post(
        "/auth/login",
        data={"username": "nobody@softtrack.dev", "password": "password123"},
    )
    assert response.status_code == 401


def test_me_returns_the_current_user(client, auth):
    actor = auth(email="me@softtrack.dev")
    response = client.get("/auth/me", headers=actor["headers"])
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "me@softtrack.dev"
    # UserMe: what the account is, plus what it may do instance-wide. Only
    # ever returned for yourself -- UserPublic elsewhere stops short of it.
    assert set(body) == {
        "id",
        "email",
        "username",
        "full_name",
        "avatar_color",
        "is_active",
        "is_site_admin",
        "created_at",
    }


def test_me_requires_a_token(client):
    assert client.get("/auth/me").status_code == 401


def test_me_rejects_a_garbage_token(client):
    response = client.get("/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert response.status_code == 401


def test_a_token_for_the_wrong_version_is_rejected(client, auth):
    """The revocation check itself, independent of what bumped the version."""
    from lib_utils.token import create_access_token

    actor = auth(email="ver@softtrack.dev")
    stale = create_access_token(subject=str(actor["user"]["id"]), version=99)
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {stale}"})
    assert response.status_code == 401


def test_a_token_without_a_version_still_works(client, auth):
    """Tokens minted before this feature carry no `ver`; read as 0, they match."""
    from datetime import datetime, timedelta, timezone

    from jose import jwt

    from web import settings

    actor = auth(email="legacy@softtrack.dev")
    legacy = jwt.encode(
        {
            "sub": str(actor["user"]["id"]),
            "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
        },
        settings.secret_key,
        algorithm=settings.algorithm,
    )
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {legacy}"})
    assert response.status_code == 200

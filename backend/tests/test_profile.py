"""Editing your own account: the profile, the password, and ending sessions."""

import pytest


def test_me_reports_the_new_account_fields(client, auth):
    actor = auth(email="me@softtrack.dev")
    body = client.get("/auth/me", headers=actor["headers"]).json()
    assert body["username"] == "me"
    assert body["is_active"] is True
    # First account registered on the instance.
    assert body["is_site_admin"] is True
    assert "created_at" in body


def test_a_username_is_derived_from_the_address(client, auth):
    actor = auth(email="Ada.Lovelace+work@softtrack.dev")
    assert actor["user"]["username"] == "ada.lovelace-work"


def test_a_colliding_local_part_gets_a_number(client, auth):
    first = auth(email="sam@a.com")
    second = auth(email="sam@b.com")
    assert first["user"]["username"] == "sam"
    assert second["user"]["username"] == "sam2"


def test_patching_name_username_and_colour(client, auth):
    actor = auth()
    response = client.patch(
        "/auth/me",
        json={
            "full_name": "Ada Lovelace",
            "username": "  ADA  ",
            "avatar_color": "#EC4899",
        },
        headers=actor["headers"],
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["full_name"] == "Ada Lovelace"
    # Normalised, so `@Ada` and `@ada` cannot be two different people.
    assert body["username"] == "ada"
    assert body["avatar_color"] == "#ec4899"


@pytest.mark.parametrize("bad", ["a", "-nope", "has space", "way" * 20])
def test_an_invalid_username_is_refused(client, auth, bad):
    actor = auth()
    response = client.patch(
        "/auth/me", json={"username": bad}, headers=actor["headers"]
    )
    assert response.status_code == 400


def test_a_taken_username_is_refused(client, auth):
    auth(email="first@softtrack.dev")
    second = auth(email="second@softtrack.dev")
    response = client.patch(
        "/auth/me", json={"username": "first"}, headers=second["headers"]
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "That username is taken"


def test_keeping_your_own_username_is_not_a_collision(client, auth):
    actor = auth(email="ada@softtrack.dev")
    response = client.patch(
        "/auth/me", json={"username": "ada"}, headers=actor["headers"]
    )
    assert response.status_code == 200


def test_a_blank_name_is_refused(client, auth):
    actor = auth()
    response = client.patch(
        "/auth/me", json={"full_name": "   "}, headers=actor["headers"]
    )
    assert response.status_code == 400


def test_a_one_character_local_part_still_makes_a_usable_handle(client, auth):
    """`a@x.dev` would derive `a`, a character short of what the pattern takes."""
    actor = auth(email="a@softtrack.dev")
    assert actor["user"]["username"] == "a-user"


def test_an_invalid_colour_is_refused(client, auth):
    actor = auth()
    response = client.patch(
        "/auth/me", json={"avatar_color": "purple"}, headers=actor["headers"]
    )
    assert response.status_code == 400


def test_changing_your_email_needs_the_current_password(client, auth):
    actor = auth(email="old@softtrack.dev")
    refused = client.patch(
        "/auth/me", json={"email": "new@softtrack.dev"}, headers=actor["headers"]
    )
    assert refused.status_code == 400

    wrong = client.patch(
        "/auth/me",
        json={"email": "new@softtrack.dev", "current_password": "nope-nope"},
        headers=actor["headers"],
    )
    assert wrong.status_code == 400

    ok = client.patch(
        "/auth/me",
        json={"email": "New@Softtrack.dev", "current_password": "password123"},
        headers=actor["headers"],
    )
    assert ok.status_code == 200
    assert ok.json()["email"] == "new@softtrack.dev"


def test_you_cannot_take_someone_elses_email(client, auth):
    auth(email="taken@softtrack.dev")
    actor = auth(email="mine@softtrack.dev")
    response = client.patch(
        "/auth/me",
        json={"email": "taken@softtrack.dev", "current_password": "password123"},
        headers=actor["headers"],
    )
    assert response.status_code == 400


def test_changing_a_password_kills_the_old_tokens_but_not_this_one(client, auth):
    actor = auth(email="rotate@softtrack.dev")
    old_headers = actor["headers"]

    response = client.post(
        "/auth/me/password",
        json={"current_password": "password123", "new_password": "brand-new-pw"},
        headers=old_headers,
    )
    assert response.status_code == 200, response.text
    fresh = {"Authorization": f"Bearer {response.json()['access_token']}"}

    # The token that made the change still works -- securing your account
    # should not sign you out of the tab you did it from.
    assert client.get("/auth/me", headers=fresh).status_code == 200
    assert client.get("/auth/me", headers=old_headers).status_code == 401


def test_changing_a_password_needs_the_current_one(client, auth):
    actor = auth()
    response = client.post(
        "/auth/me/password",
        json={"current_password": "wrong-one", "new_password": "brand-new-pw"},
        headers=actor["headers"],
    )
    assert response.status_code == 400


def test_a_short_new_password_is_refused(client, auth):
    actor = auth()
    response = client.post(
        "/auth/me/password",
        json={"current_password": "password123", "new_password": "short"},
        headers=actor["headers"],
    )
    assert response.status_code == 422


def test_the_new_password_is_the_one_that_works(client, auth):
    auth(email="rotate@softtrack.dev")
    actor = auth(email="rotate2@softtrack.dev")
    client.post(
        "/auth/me/password",
        json={"current_password": "password123", "new_password": "brand-new-pw"},
        headers=actor["headers"],
    )
    assert (
        client.post(
            "/auth/login",
            data={"username": "rotate2@softtrack.dev", "password": "password123"},
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/auth/login",
            data={"username": "rotate2@softtrack.dev", "password": "brand-new-pw"},
        ).status_code
        == 200
    )


def test_sign_out_everywhere_invalidates_the_other_tabs(client, auth):
    actor = auth(email="everywhere@softtrack.dev")
    other_tab = client.post(
        "/auth/login",
        data={"username": "everywhere@softtrack.dev", "password": "password123"},
    ).json()
    other_headers = {"Authorization": f"Bearer {other_tab['access_token']}"}

    response = client.post("/auth/me/sign-out-everywhere", headers=actor["headers"])
    assert response.status_code == 200
    kept = {"Authorization": f"Bearer {response.json()['access_token']}"}

    assert client.get("/auth/me", headers=kept).status_code == 200
    assert client.get("/auth/me", headers=other_headers).status_code == 401
    assert client.get("/auth/me", headers=actor["headers"]).status_code == 401


def test_login_is_case_insensitive_about_the_address(client, auth):
    auth(email="Mixed@Softtrack.dev")
    response = client.post(
        "/auth/login",
        data={"username": "mixed@softtrack.dev", "password": "password123"},
    )
    assert response.status_code == 200


def test_registering_with_a_chosen_username(client):
    response = client.post(
        "/auth/register",
        json={
            "email": "pick@softtrack.dev",
            "password": "password123",
            "full_name": "Picker",
            "username": "picked",
        },
    )
    assert response.status_code == 200
    assert response.json()["user"]["username"] == "picked"

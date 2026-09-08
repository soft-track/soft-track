"""The site administrator: the user directory, deactivation, and password resets."""


def test_the_first_account_owns_the_instance(client, auth):
    first = auth(email="first@softtrack.dev")
    second = auth(email="second@softtrack.dev")
    assert first["user"]["is_site_admin"] is True
    assert second["user"]["is_site_admin"] is False


def test_a_normal_user_cannot_reach_the_directory(client, auth):
    auth(email="first@softtrack.dev")
    second = auth(email="second@softtrack.dev")
    response = client.get("/admin/users", headers=second["headers"])
    assert response.status_code == 403
    assert response.json()["detail"] == "Only site administrators can do that"


def test_the_directory_lists_everyone_with_a_team_count(client, team, auth):
    auth(email="ada@softtrack.dev", full_name="Ada Lovelace")
    response = client.get("/admin/users", headers=team["headers"])
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    demo = next(u for u in body["items"] if u["email"] == "demo@softtrack.dev")
    ada = next(u for u in body["items"] if u["email"] == "ada@softtrack.dev")
    assert demo["team_count"] == 1
    assert ada["team_count"] == 0


def test_searching_the_directory(client, auth):
    admin = auth(email="admin@softtrack.dev")
    auth(email="ada@softtrack.dev", full_name="Ada Lovelace")
    auth(email="grace@softtrack.dev", full_name="Grace Hopper")

    by_name = client.get("/admin/users?q=grace", headers=admin["headers"]).json()
    assert [u["email"] for u in by_name["items"]] == ["grace@softtrack.dev"]

    by_username = client.get("/admin/users?q=ada", headers=admin["headers"]).json()
    assert [u["email"] for u in by_username["items"]] == ["ada@softtrack.dev"]

    assert (
        client.get("/admin/users?q=zzz", headers=admin["headers"]).json()["total"] == 0
    )


def test_the_directory_paginates(client, auth):
    admin = auth(email="admin@softtrack.dev")
    for i in range(4):
        auth(email=f"person{i}@softtrack.dev")

    page = client.get("/admin/users?limit=2&offset=1", headers=admin["headers"]).json()
    assert page["total"] == 5
    assert len(page["items"]) == 2
    assert page["offset"] == 1


def test_deactivating_ends_the_session_and_blocks_sign_in(client, auth):
    admin = auth(email="admin@softtrack.dev")
    ada = auth(email="ada@softtrack.dev")

    response = client.patch(
        f"/admin/users/{ada['user']['id']}",
        json={"is_active": False},
        headers=admin["headers"],
    )
    assert response.status_code == 200
    assert response.json()["is_active"] is False

    # The token she is holding stops working immediately...
    assert client.get("/auth/me", headers=ada["headers"]).status_code == 401
    # ...and she cannot get a new one.
    login = client.post(
        "/auth/login",
        data={"username": "ada@softtrack.dev", "password": "password123"},
    )
    assert login.status_code == 403
    assert login.json()["detail"] == "This account has been deactivated"


def test_reactivating_lets_them_back_in(client, auth):
    admin = auth(email="admin@softtrack.dev")
    ada = auth(email="ada@softtrack.dev")

    client.patch(
        f"/admin/users/{ada['user']['id']}",
        json={"is_active": False},
        headers=admin["headers"],
    )
    client.patch(
        f"/admin/users/{ada['user']['id']}",
        json={"is_active": True},
        headers=admin["headers"],
    )
    assert (
        client.post(
            "/auth/login",
            data={"username": "ada@softtrack.dev", "password": "password123"},
        ).status_code
        == 200
    )


def test_you_cannot_deactivate_or_demote_yourself(client, auth):
    admin = auth(email="admin@softtrack.dev")

    deactivate = client.patch(
        f"/admin/users/{admin['user']['id']}",
        json={"is_active": False},
        headers=admin["headers"],
    )
    assert deactivate.status_code == 400

    demote = client.patch(
        f"/admin/users/{admin['user']['id']}",
        json={"is_site_admin": False},
        headers=admin["headers"],
    )
    assert demote.status_code == 400


def test_the_last_site_admin_cannot_be_demoted_by_another(client, auth):
    """Two admins, each demoted by the other: the second attempt is the one that must fail."""
    first = auth(email="first@softtrack.dev")
    second = auth(email="second@softtrack.dev")

    client.patch(
        f"/admin/users/{second['user']['id']}",
        json={"is_site_admin": True},
        headers=first["headers"],
    )
    # second demotes first: fine, second is still an admin.
    assert (
        client.patch(
            f"/admin/users/{first['user']['id']}",
            json={"is_site_admin": False},
            headers=second["headers"],
        ).status_code
        == 200
    )
    # first is no longer an admin, so cannot demote anyone.
    assert (
        client.patch(
            f"/admin/users/{second['user']['id']}",
            json={"is_site_admin": False},
            headers=first["headers"],
        ).status_code
        == 403
    )


def test_the_last_site_admin_cannot_be_deactivated(client, auth):
    first = auth(email="first@softtrack.dev")
    second = auth(email="second@softtrack.dev")
    client.patch(
        f"/admin/users/{second['user']['id']}",
        json={"is_site_admin": True},
        headers=first["headers"],
    )
    client.patch(
        f"/admin/users/{first['user']['id']}",
        json={"is_site_admin": False},
        headers=second["headers"],
    )

    # `second` is now the only active site admin; `first` may not switch them off.
    response = client.patch(
        f"/admin/users/{second['user']['id']}",
        json={"is_active": False},
        headers=first["headers"],
    )
    assert response.status_code == 403  # first is not an admin any more

    # And second cannot do it to themselves either.
    assert (
        client.patch(
            f"/admin/users/{second['user']['id']}",
            json={"is_active": False},
            headers=second["headers"],
        ).status_code
        == 400
    )


def test_promoting_grants_the_console(client, auth):
    admin = auth(email="admin@softtrack.dev")
    ada = auth(email="ada@softtrack.dev")

    assert client.get("/admin/users", headers=ada["headers"]).status_code == 403
    client.patch(
        f"/admin/users/{ada['user']['id']}",
        json={"is_site_admin": True},
        headers=admin["headers"],
    )
    assert client.get("/admin/users", headers=ada["headers"]).status_code == 200


def test_registering_counts_as_a_sign_in(client, auth):
    """Otherwise someone who signed up a minute ago reads as "never signed in"."""
    admin = auth(email="admin@softtrack.dev")
    body = client.get("/admin/users", headers=admin["headers"]).json()
    assert body["items"][0]["last_login_at"] is not None


def test_an_admin_can_rename_someone(client, auth):
    admin = auth(email="admin@softtrack.dev")
    ada = auth(email="ada@softtrack.dev", full_name="A Lovelace")
    response = client.patch(
        f"/admin/users/{ada['user']['id']}",
        json={"full_name": "Ada Lovelace"},
        headers=admin["headers"],
    )
    assert response.json()["full_name"] == "Ada Lovelace"


def test_an_admin_cannot_blank_someones_name(client, auth):
    admin = auth(email="admin@softtrack.dev")
    ada = auth(email="ada@softtrack.dev")
    response = client.patch(
        f"/admin/users/{ada['user']['id']}",
        json={"full_name": "  "},
        headers=admin["headers"],
    )
    assert response.status_code == 400


def test_updating_an_unknown_user_is_a_404(client, auth):
    admin = auth(email="admin@softtrack.dev")
    response = client.patch(
        "/admin/users/9999", json={"is_active": False}, headers=admin["headers"]
    )
    assert response.status_code == 404


def test_resetting_a_password_replaces_it_and_ends_the_sessions(client, auth):
    admin = auth(email="admin@softtrack.dev")
    ada = auth(email="ada@softtrack.dev")

    response = client.post(
        f"/admin/users/{ada['user']['id']}/reset-password",
        json={"new_password": "a-new-password"},
        headers=admin["headers"],
    )
    assert response.status_code == 204

    assert client.get("/auth/me", headers=ada["headers"]).status_code == 401
    assert (
        client.post(
            "/auth/login",
            data={"username": "ada@softtrack.dev", "password": "password123"},
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/auth/login",
            data={"username": "ada@softtrack.dev", "password": "a-new-password"},
        ).status_code
        == 200
    )


def test_a_normal_user_cannot_reset_a_password(client, auth):
    auth(email="admin@softtrack.dev")
    ada = auth(email="ada@softtrack.dev")
    victim = auth(email="victim@softtrack.dev")
    response = client.post(
        f"/admin/users/{victim['user']['id']}/reset-password",
        json={"new_password": "a-new-password"},
        headers=ada["headers"],
    )
    assert response.status_code == 403

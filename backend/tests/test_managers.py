"""Manager links (#124): who somebody reports to, never in a loop."""

import pytest
from sqlalchemy import event

from lib_identity import admin as admin_service
from lib_softtrack.tables import User


@pytest.fixture
def admin(auth):
    """The first account, and so the site admin."""
    return auth(email="admin@softtrack.dev", full_name="Site Admin")


@pytest.fixture
def people(auth):
    """Amina, Daniel and Kenji, reporting to nobody yet."""
    return {
        name: auth(email=f"{name}@softtrack.dev", full_name=full)
        for name, full in [
            ("amina", "Amina Khan"),
            ("daniel", "Daniel Okafor"),
            ("kenji", "Kenji Watanabe"),
        ]
    }


def _set_manager(client, admin, person, manager):
    return client.patch(
        f"/admin/users/{person['user']['id']}",
        json={"manager_id": manager["user"]["id"] if manager else None},
        headers=admin["headers"],
    )


def _manager_of(client, person):
    return client.get("/auth/me", headers=person["headers"]).json()["manager"]


def _row(client, admin, person, **params):
    items = client.get(
        "/admin/users", params={"limit": 200, **params}, headers=admin["headers"]
    ).json()["items"]
    return next((row for row in items if row["id"] == person["user"]["id"]), None)


def test_a_site_admin_sets_a_manager_and_both_ends_show_it(client, admin, people):
    amina, daniel = people["amina"], people["daniel"]
    client.patch(
        "/auth/me", json={"job_title": "Engineering Manager"}, headers=amina["headers"]
    )

    response = _set_manager(client, admin, daniel, amina)
    assert response.status_code == 200, response.text
    assert _manager_of(client, daniel) == {
        "id": amina["user"]["id"],
        "username": "amina",
        "full_name": "Amina Khan",
        "avatar_color": amina["user"]["avatar_color"],
        "is_active": True,
        "job_title": "Engineering Manager",
    }
    assert _row(client, admin, amina)["report_count"] == 1
    assert _row(client, admin, daniel)["report_count"] == 0


def test_null_clears_it_and_leaving_it_out_keeps_it(client, admin, people):
    amina, daniel = people["amina"], people["daniel"]
    _set_manager(client, admin, daniel, amina)

    client.patch(
        f"/admin/users/{daniel['user']['id']}",
        json={"started_on": "2024-02-01"},
        headers=admin["headers"],
    )
    assert _manager_of(client, daniel)["username"] == "amina"

    assert _set_manager(client, admin, daniel, None).status_code == 200
    assert _manager_of(client, daniel) is None


def test_nobody_is_their_own_manager(client, admin, people):
    amina = people["amina"]
    response = _set_manager(client, admin, amina, amina)
    assert response.status_code == 400
    assert response.json() == {
        "detail": "Amina Khan can’t be their own manager",
        "code": "manager_is_self",
    }


def test_a_loop_is_refused_with_a_sentence(client, admin, people):
    amina, daniel = people["amina"], people["daniel"]
    _set_manager(client, admin, daniel, amina)

    response = _set_manager(client, admin, amina, daniel)
    assert response.status_code == 400
    assert response.json() == {
        "detail": "Amina Khan can’t report to Daniel Okafor: Daniel Okafor "
        "already reports to Amina Khan",
        "code": "manager_cycle",
    }
    assert _manager_of(client, amina) is None


def test_a_loop_through_somebody_else_is_refused_too(client, admin, people):
    amina, daniel, kenji = people["amina"], people["daniel"], people["kenji"]
    _set_manager(client, admin, daniel, amina)
    _set_manager(client, admin, kenji, daniel)

    response = _set_manager(client, admin, amina, kenji)
    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Amina Khan can’t report to Kenji Watanabe: Kenji Watanabe already "
        "reports up to Amina Khan"
    )


def test_a_chain_that_is_not_a_loop_is_fine(client, admin, people):
    amina, daniel, kenji = people["amina"], people["daniel"], people["kenji"]
    _set_manager(client, admin, daniel, amina)
    assert _set_manager(client, admin, kenji, daniel).status_code == 200
    # Moving somebody across the chain, and back, is not a loop either.
    assert _set_manager(client, admin, kenji, amina).status_code == 200
    assert _set_manager(client, admin, kenji, daniel).status_code == 200


def test_the_manager_has_to_exist(client, admin, people):
    response = client.patch(
        f"/admin/users/{people['amina']['user']['id']}",
        json={"manager_id": 999},
        headers=admin["headers"],
    )
    assert response.status_code == 400
    assert response.json()["code"] == "user_not_found"


def test_only_a_site_admin_sets_one(client, admin, people):
    amina, daniel = people["amina"], people["daniel"]
    refused = client.patch(
        f"/admin/users/{daniel['user']['id']}",
        json={"manager_id": amina["user"]["id"]},
        headers=amina["headers"],
    )
    assert refused.status_code == 403
    # Nor from your own profile.
    ignored = client.patch(
        "/auth/me", json={"manager_id": amina["user"]["id"]}, headers=daniel["headers"]
    )
    assert ignored.status_code == 200
    assert ignored.json()["manager"] is None


# --- Deactivation ------------------------------------------------------------


def _deactivate(client, admin, person):
    response = client.patch(
        f"/admin/users/{person['user']['id']}",
        json={"is_active": False},
        headers=admin["headers"],
    )
    assert response.status_code == 200, response.text


def test_deactivating_a_manager_leaves_the_links_in_place(client, admin, people):
    amina, daniel = people["amina"], people["daniel"]
    _set_manager(client, admin, daniel, amina)
    _deactivate(client, admin, amina)

    manager = _manager_of(client, daniel)
    assert (manager["username"], manager["is_active"]) == ("amina", False)
    # Saving Daniel's other details sends the same manager back, and that
    # still works although she can no longer take on anybody new.
    response = client.patch(
        f"/admin/users/{daniel['user']['id']}",
        json={"manager_id": amina["user"]["id"], "started_on": "2023-03-06"},
        headers=admin["headers"],
    )
    assert response.status_code == 200, response.text


def test_nobody_new_reports_to_a_deactivated_account(client, admin, people):
    amina, daniel = people["amina"], people["daniel"]
    _deactivate(client, admin, amina)

    response = _set_manager(client, admin, daniel, amina)
    assert response.status_code == 400
    assert response.json()["code"] == "manager_deactivated"


def test_reports_of_a_deactivated_manager_are_a_list_an_admin_can_ask_for(
    client, admin, people, auth
):
    amina, daniel, kenji = people["amina"], people["daniel"], people["kenji"]
    lina = auth(email="lina@softtrack.dev", full_name="Lina Haddad")
    sofia = auth(email="sofia@softtrack.dev", full_name="Sofia Marquez")
    _set_manager(client, admin, daniel, amina)
    _set_manager(client, admin, kenji, amina)
    # Lina reports to Sofia, who stays active: not on the list.
    _set_manager(client, admin, lina, sofia)
    _deactivate(client, admin, amina)
    # A deactivated report of a deactivated manager is nobody's problem.
    _deactivate(client, admin, kenji)

    page = client.get(
        "/admin/users",
        params={"reports_to_deactivated": True},
        headers=admin["headers"],
    ).json()
    assert [row["username"] for row in page["items"]] == ["daniel"]
    assert page["total"] == 1
    assert page["items"][0]["manager"]["is_active"] is False


def test_a_report_count_counts_active_reports(client, admin, people, auth):
    amina, daniel, kenji = people["amina"], people["daniel"], people["kenji"]
    _set_manager(client, admin, daniel, amina)
    _set_manager(client, admin, kenji, amina)
    _deactivate(client, admin, kenji)

    assert _row(client, admin, amina)["report_count"] == 1
    # And the row returned by an update says the same.
    updated = client.patch(
        f"/admin/users/{amina['user']['id']}",
        json={"started_on": "2023-03-06"},
        headers=admin["headers"],
    ).json()
    assert updated["report_count"] == 1


def test_the_directory_loads_managers_for_the_page_not_per_row(session):
    """Managers are read with the page, so a longer page costs no more."""

    def queries_for(count):
        boss = User(
            email=f"boss{count}@softtrack.dev",
            username=f"boss{count}",
            hashed_password="x",
            full_name="Boss",
        )
        session.add(boss)
        session.commit()
        for k in range(count):
            # Each row has its own manager, so the identity map cannot help.
            manager = User(
                email=f"m{count}-{k}@softtrack.dev",
                username=f"m{count}-{k}",
                hashed_password="x",
                full_name=f"M{k}",
                manager_id=boss.id,
            )
            session.add(manager)
            session.commit()
            session.add(
                User(
                    email=f"r{count}-{k}@softtrack.dev",
                    username=f"r{count}-{k}",
                    hashed_password="x",
                    full_name=f"R{k}",
                    manager_id=manager.id,
                )
            )
        session.commit()
        session.expire_all()

        statements = []

        def record(*_args):
            statements.append(1)

        engine = session.get_bind()
        event.listen(engine, "before_cursor_execute", record)
        try:
            page = admin_service.list_users(session, q=f"r{count}-")
        finally:
            event.remove(engine, "before_cursor_execute", record)
        assert all(row.manager is not None for row in page.items)
        return len(statements)

    assert queries_for(3) == queries_for(12)

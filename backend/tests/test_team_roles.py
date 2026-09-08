"""Admin vs member inside a team, and the guard that keeps a team from being orphaned."""

import pytest
from sqlmodel import select

from lib_softtrack.tables import User


@pytest.fixture
def team_with_member(client, team, auth):
    """An admin-owned team plus one plain member, which is the interesting shape."""
    member = auth(email="member@softtrack.dev", full_name="Plain Member")
    response = client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": "member@softtrack.dev"},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return {**team, "member": member}


def test_the_creator_is_an_admin(client, team):
    members = client.get(
        f"/teams/{team['team']['id']}/members", headers=team["headers"]
    ).json()
    assert members[0]["role"] == "admin"
    assert members[0]["joined_at"]


def test_a_member_cannot_add_anyone(client, team_with_member, auth):
    auth(email="third@softtrack.dev")
    response = client.post(
        f"/teams/{team_with_member['team']['id']}/members",
        json={"email": "third@softtrack.dev"},
        headers=team_with_member["member"]["headers"],
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Only team admins can do that"


def test_a_member_cannot_rename_the_team(client, team_with_member):
    response = client.patch(
        f"/teams/{team_with_member['team']['id']}",
        json={"name": "Hijacked"},
        headers=team_with_member["member"]["headers"],
    )
    assert response.status_code == 403


def test_an_admin_renames_the_team(client, team):
    response = client.patch(
        f"/teams/{team['team']['id']}",
        json={"name": "Platform", "description": "Runs the platform"},
        headers=team["headers"],
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Platform"
    assert response.json()["description"] == "Runs the platform"


def test_the_team_key_cannot_be_changed(client, team):
    """Not a field on TeamUpdate, so an attempt to set it is simply ignored."""
    response = client.patch(
        f"/teams/{team['team']['id']}",
        json={"key": "NEW"},
        headers=team["headers"],
    )
    assert response.status_code == 200
    assert response.json()["key"] == "ENG"


def test_a_member_cannot_change_roles(client, team_with_member):
    admin_id = team_with_member["user"]["id"]
    response = client.patch(
        f"/teams/{team_with_member['team']['id']}/members/{admin_id}",
        json={"role": "member"},
        headers=team_with_member["member"]["headers"],
    )
    assert response.status_code == 403


def test_an_admin_promotes_a_member(client, team_with_member):
    member_id = team_with_member["member"]["user"]["id"]
    response = client.patch(
        f"/teams/{team_with_member['team']['id']}/members/{member_id}",
        json={"role": "admin"},
        headers=team_with_member["headers"],
    )
    assert response.status_code == 200
    assert response.json()["role"] == "admin"

    # ...and the promoted member can now administer.
    assert (
        client.patch(
            f"/teams/{team_with_member['team']['id']}",
            json={"name": "Renamed by the new admin"},
            headers=team_with_member["member"]["headers"],
        ).status_code
        == 200
    )


def test_changing_the_role_of_a_non_member_is_a_404(client, team, auth):
    outsider = auth(email="outsider@softtrack.dev")
    response = client.patch(
        f"/teams/{team['team']['id']}/members/{outsider['user']['id']}",
        json={"role": "admin"},
        headers=team["headers"],
    )
    assert response.status_code == 404


def test_the_last_admin_cannot_be_demoted(client, team_with_member):
    admin_id = team_with_member["user"]["id"]
    response = client.patch(
        f"/teams/{team_with_member['team']['id']}/members/{admin_id}",
        json={"role": "member"},
        headers=team_with_member["headers"],
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "A team needs at least one admin"


def test_the_last_admin_cannot_leave(client, team_with_member):
    admin_id = team_with_member["user"]["id"]
    response = client.delete(
        f"/teams/{team_with_member['team']['id']}/members/{admin_id}",
        headers=team_with_member["headers"],
    )
    assert response.status_code == 409


def test_an_admin_can_leave_once_there_is_another(client, team_with_member):
    team_id = team_with_member["team"]["id"]
    member_id = team_with_member["member"]["user"]["id"]
    admin_id = team_with_member["user"]["id"]

    client.patch(
        f"/teams/{team_id}/members/{member_id}",
        json={"role": "admin"},
        headers=team_with_member["headers"],
    )
    response = client.delete(
        f"/teams/{team_id}/members/{admin_id}", headers=team_with_member["headers"]
    )
    assert response.status_code == 204


def test_a_deactivated_admin_does_not_count(client, team_with_member, session):
    """The guard counts admins who could actually act, not rows.

    Otherwise a team whose other admin was deactivated months ago looks safe
    to leave, and is left with nobody who can add anyone.
    """
    team_id = team_with_member["team"]["id"]
    member_id = team_with_member["member"]["user"]["id"]
    admin_id = team_with_member["user"]["id"]

    client.patch(
        f"/teams/{team_id}/members/{member_id}",
        json={"role": "admin"},
        headers=team_with_member["headers"],
    )
    dormant = session.exec(select(User).where(User.id == member_id)).one()
    dormant.is_active = False
    session.add(dormant)
    session.commit()

    response = client.delete(
        f"/teams/{team_id}/members/{admin_id}", headers=team_with_member["headers"]
    )
    assert response.status_code == 409


def test_a_member_can_leave(client, team_with_member):
    team_id = team_with_member["team"]["id"]
    member_id = team_with_member["member"]["user"]["id"]

    response = client.delete(
        f"/teams/{team_id}/members/{member_id}",
        headers=team_with_member["member"]["headers"],
    )
    assert response.status_code == 204
    assert (
        client.get(
            f"/teams/{team_id}", headers=team_with_member["member"]["headers"]
        ).status_code
        == 403
    )


def test_a_member_cannot_remove_someone_else(client, team_with_member):
    admin_id = team_with_member["user"]["id"]
    response = client.delete(
        f"/teams/{team_with_member['team']['id']}/members/{admin_id}",
        headers=team_with_member["member"]["headers"],
    )
    assert response.status_code == 403


def test_an_admin_removes_a_member(client, team_with_member):
    team_id = team_with_member["team"]["id"]
    member_id = team_with_member["member"]["user"]["id"]

    assert (
        client.delete(
            f"/teams/{team_id}/members/{member_id}", headers=team_with_member["headers"]
        ).status_code
        == 204
    )
    members = client.get(
        f"/teams/{team_id}/members", headers=team_with_member["headers"]
    ).json()
    assert [m["user"]["email"] for m in members] == ["demo@softtrack.dev"]


def test_members_are_listed_admins_first(client, team_with_member):
    members = client.get(
        f"/teams/{team_with_member['team']['id']}/members",
        headers=team_with_member["headers"],
    ).json()
    assert [m["role"] for m in members] == ["admin", "member"]


def test_a_deactivated_account_cannot_be_added(client, team, auth, session):
    auth(email="dormant@softtrack.dev")
    dormant = session.exec(
        select(User).where(User.email == "dormant@softtrack.dev")
    ).one()
    dormant.is_active = False
    session.add(dormant)
    session.commit()

    response = client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": "dormant@softtrack.dev"},
        headers=team["headers"],
    )
    assert response.status_code == 400

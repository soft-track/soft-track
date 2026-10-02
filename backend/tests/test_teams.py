import pytest
from sqlmodel import select

from lib_softtrack.tables import (
    CustomField,
    CustomFieldValue,
    OutboundWebhook,
    SavedView,
    Team,
    UserDefaultView,
    WebhookDelivery,
)


@pytest.fixture
def admin(auth):
    """The first account, and so the site admin."""
    return auth(email="admin@softtrack.dev", full_name="Site Admin")


def test_creating_a_team_makes_the_creator_a_member(client, team):
    response = client.get("/teams", headers=team["headers"])
    assert response.status_code == 200
    assert [t["key"] for t in response.json()] == ["ENG"]


def test_team_keys_are_uppercased(client, auth):
    actor = auth()
    response = client.post(
        "/teams", json={"name": "Design", "key": "dsn"}, headers=actor["headers"]
    )
    assert response.json()["key"] == "DSN"


def test_a_duplicate_team_key_is_rejected(client, team):
    response = client.post(
        "/teams", json={"name": "Other", "key": "ENG"}, headers=team["headers"]
    )
    assert response.status_code == 400


def test_a_non_member_cannot_read_a_team(client, team, auth):
    outsider = auth(email="outsider@softtrack.dev")
    response = client.get(f"/teams/{team['team']['id']}", headers=outsider["headers"])
    assert response.status_code == 403


def test_a_non_member_cannot_list_team_tickets(client, team, auth):
    """The tenancy boundary. If this ever returns 200, teams leak into each other."""
    outsider = auth(email="outsider@softtrack.dev")
    response = client.get(
        f"/teams/{team['team']['id']}/tickets", headers=outsider["headers"]
    )
    assert response.status_code == 403


def test_listing_teams_only_returns_your_own(client, team, auth):
    outsider = auth(email="outsider@softtrack.dev")
    assert client.get("/teams", headers=outsider["headers"]).json() == []


def test_listing_teams_excludes_archived_teams_but_keeps_direct_access(client, team):
    archived_team = client.post(
        "/teams",
        json={"name": "Archive Test", "key": "ARC"},
        headers=team["headers"],
    ).json()
    client.patch(
        f"/teams/{archived_team['id']}",
        json={"archived": True},
        headers=team["headers"],
    )

    teams = client.get("/teams", headers=team["headers"]).json()
    assert [t["id"] for t in teams] == [team["team"]["id"]]

    response = client.get(f"/teams/{archived_team['id']}", headers=team["headers"])
    assert response.status_code == 200
    assert response.json()["id"] == archived_team["id"]
    assert response.json()["archived"] is True


def test_adding_a_member_by_email(client, team, auth):
    other = auth(email="colleague@softtrack.dev")
    response = client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": "colleague@softtrack.dev"},
        headers=team["headers"],
    )
    assert response.status_code == 200
    assert response.json()["user"]["email"] == "colleague@softtrack.dev"
    assert response.json()["user"]["username"] == "colleague"
    assert response.json()["joined_at"]
    # the new member can now see the team
    assert (
        client.get(f"/teams/{team['team']['id']}", headers=other["headers"]).status_code
        == 200
    )


def test_adding_an_unknown_email_is_a_404(client, team):
    response = client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": "ghost@softtrack.dev"},
        headers=team["headers"],
    )
    assert response.status_code == 404


def test_an_admin_can_archive_a_team(client, team):
    response = client.patch(
        f"/teams/{team['team']['id']}",
        json={"archived": True},
        headers=team["headers"],
    )
    assert response.status_code == 200
    assert response.json()["archived"] is True


def test_an_archived_team_can_be_restored(client, team):
    client.patch(
        f"/teams/{team['team']['id']}",
        json={"archived": True},
        headers=team["headers"],
    )

    response = client.patch(
        f"/teams/{team['team']['id']}",
        json={"archived": False},
        headers=team["headers"],
    )
    assert response.status_code == 200
    assert response.json()["archived"] is False


def test_an_archived_team_rejects_metadata_changes(client, team):
    client.patch(
        f"/teams/{team['team']['id']}",
        json={"archived": True},
        headers=team["headers"],
    )

    response = client.patch(
        f"/teams/{team['team']['id']}",
        json={"name": "Retired Team"},
        headers=team["headers"],
    )
    assert response.status_code == 403
    assert response.json()["code"] == "team_read_only"


def test_a_team_writer_endpoint_is_allowed_while_active_and_rejected_when_archived(
    client, team
):
    response = client.post(
        f"/teams/{team['team']['id']}/projects",
        json={"name": "Release", "key": "REL"},
        headers=team["headers"],
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Release"

    client.patch(
        f"/teams/{team['team']['id']}",
        json={"archived": True},
        headers=team["headers"],
    )

    response = client.post(
        f"/teams/{team['team']['id']}/projects",
        json={"name": "Retired Project", "key": "RTP"},
        headers=team["headers"],
    )
    assert response.status_code == 403
    assert response.json()["code"] == "team_read_only"


def test_a_normal_team_write_is_allowed_while_active(client, team):
    response = client.post(
        f"/teams/{team['team']['id']}/tickets",
        json={"title": "Ready to ship"},
        headers=team["headers"],
    )
    assert response.status_code == 200
    assert response.json()["title"] == "Ready to ship"


def test_an_archived_team_rejects_a_normal_write_via_the_central_guard(client, team):
    client.patch(
        f"/teams/{team['team']['id']}",
        json={"archived": True},
        headers=team["headers"],
    )

    response = client.post(
        f"/teams/{team['team']['id']}/tickets",
        json={"title": "Should be refused"},
        headers=team["headers"],
    )
    assert response.status_code == 403
    assert response.json()["code"] == "team_read_only"


def test_an_archived_team_is_still_readable(client, team):
    client.patch(
        f"/teams/{team['team']['id']}",
        json={"archived": True},
        headers=team["headers"],
    )

    response = client.get(f"/teams/{team['team']['id']}", headers=team["headers"])
    assert response.status_code == 200
    assert response.json()["archived"] is True


def test_a_team_admin_can_restore_an_archived_team(client, team):
    client.patch(
        f"/teams/{team['team']['id']}",
        json={"archived": True},
        headers=team["headers"],
    )

    response = client.patch(
        f"/teams/{team['team']['id']}",
        json={"archived": False},
        headers=team["headers"],
    )
    assert response.status_code == 200
    assert response.json()["archived"] is False


def test_a_site_admin_can_restore_an_archived_team(client, auth, admin):
    owner = auth(email="owner@softtrack.dev", full_name="Owner User")
    team_response = client.post(
        "/teams",
        json={"name": "Engineering", "key": "ENG"},
        headers=owner["headers"],
    )
    team_id = team_response.json()["id"]
    client.patch(
        f"/teams/{team_id}",
        json={"archived": True},
        headers=admin["headers"],
    )

    response = client.patch(
        f"/teams/{team_id}",
        json={"archived": False},
        headers=admin["headers"],
    )
    assert response.status_code == 200
    assert response.json()["archived"] is False


def test_an_ordinary_member_cannot_restore_an_archived_team(client, auth):
    owner = auth(email="owner@softtrack.dev", full_name="Owner User")
    member = auth(email="member@softtrack.dev", full_name="Member User")
    team_response = client.post(
        "/teams", json={"name": "Engineering", "key": "ENG"}, headers=owner["headers"]
    )
    assert team_response.status_code == 200
    team_id = team_response.json()["id"]
    client.post(
        f"/teams/{team_id}/members",
        json={"email": member["user"]["email"], "role": "member"},
        headers=owner["headers"],
    )
    client.patch(
        f"/teams/{team_id}",
        json={"archived": True},
        headers=owner["headers"],
    )

    response = client.patch(
        f"/teams/{team_id}",
        json={"archived": False},
        headers=member["headers"],
    )
    assert response.status_code == 403
    assert response.json()["code"] == "not_team_admin"


def test_a_team_admin_cannot_change_metadata_while_restoring_an_archived_team(
    client, team
):
    client.patch(
        f"/teams/{team['team']['id']}",
        json={"archived": True},
        headers=team["headers"],
    )

    response = client.patch(
        f"/teams/{team['team']['id']}",
        json={"archived": False, "name": "New Name"},
        headers=team["headers"],
    )
    assert response.status_code == 403
    assert response.json()["code"] == "team_read_only"
    assert (
        client.get(f"/teams/{team['team']['id']}", headers=team["headers"]).json()[
            "name"
        ]
        != "New Name"
    )


def test_a_site_admin_cannot_change_metadata_while_restoring_an_archived_team(
    client, auth, admin
):
    owner = auth(email="owner@softtrack.dev", full_name="Owner User")
    team_response = client.post(
        "/teams",
        json={"name": "Engineering", "key": "ENG"},
        headers=owner["headers"],
    )
    team_id = team_response.json()["id"]
    client.patch(
        f"/teams/{team_id}",
        json={"archived": True},
        headers=admin["headers"],
    )

    response = client.patch(
        f"/teams/{team_id}",
        json={"archived": False, "name": "New Name"},
        headers=admin["headers"],
    )
    assert response.status_code == 403
    assert response.json()["code"] == "team_read_only"
    assert (
        client.get(f"/teams/{team_id}", headers=owner["headers"]).json()["name"]
        != "New Name"
    )


def test_an_ordinary_member_cannot_archive_a_team(client, auth):
    owner = auth(email="owner@softtrack.dev", full_name="Owner User")
    member = auth(email="member@softtrack.dev", full_name="Member User")
    team_response = client.post(
        "/teams", json={"name": "Engineering", "key": "ENG"}, headers=owner["headers"]
    )
    assert team_response.status_code == 200
    team_id = team_response.json()["id"]
    client.post(
        f"/teams/{team_id}/members",
        json={"email": member["user"]["email"], "role": "member"},
        headers=owner["headers"],
    )

    response = client.patch(
        f"/teams/{team_id}",
        json={"archived": True},
        headers=member["headers"],
    )
    assert response.status_code == 403
    assert response.json()["code"] == "not_team_admin"


def test_an_ordinary_member_cannot_restore_an_archived_team(client, auth):
    owner = auth(email="owner@softtrack.dev", full_name="Owner User")
    member = auth(email="member@softtrack.dev", full_name="Member User")
    team_response = client.post(
        "/teams", json={"name": "Engineering", "key": "ENG"}, headers=owner["headers"]
    )
    assert team_response.status_code == 200
    team_id = team_response.json()["id"]
    client.post(
        f"/teams/{team_id}/members",
        json={"email": member["user"]["email"], "role": "member"},
        headers=owner["headers"],
    )
    client.patch(
        f"/teams/{team_id}",
        json={"archived": True},
        headers=owner["headers"],
    )

    response = client.patch(
        f"/teams/{team_id}",
        json={"archived": False},
        headers=member["headers"],
    )
    assert response.status_code == 403
    assert response.json()["code"] == "not_team_admin"


def test_a_site_admin_can_archive_a_team_they_do_not_own(client, auth, admin):
    owner = auth(email="owner@softtrack.dev", full_name="Owner User")
    team_response = client.post(
        "/teams",
        json={"name": "Engineering", "key": "ENG"},
        headers=owner["headers"],
    )
    assert team_response.status_code == 200
    team_id = team_response.json()["id"]

    response = client.patch(
        f"/teams/{team_id}",
        json={"archived": True},
        headers=admin["headers"],
    )
    assert response.status_code == 200
    assert response.json()["archived"] is True
    assert "archived" in response.json()


def test_a_site_admin_can_restore_a_team_they_do_not_own(client, auth, admin):
    owner = auth(email="owner@softtrack.dev", full_name="Owner User")
    team_response = client.post(
        "/teams",
        json={"name": "Engineering", "key": "ENG"},
        headers=owner["headers"],
    )
    assert team_response.status_code == 200
    team_id = team_response.json()["id"]
    client.patch(
        f"/teams/{team_id}",
        json={"archived": True},
        headers=admin["headers"],
    )

    response = client.patch(
        f"/teams/{team_id}",
        json={"archived": False},
        headers=admin["headers"],
    )
    assert response.status_code == 200
    assert response.json()["archived"] is False
    assert "archived" in response.json()


def test_team_read_includes_archived_for_active_and_archived_states(
    client, auth, admin
):
    owner = auth(email="owner@softtrack.dev", full_name="Owner User")
    team_response = client.post(
        "/teams",
        json={"name": "Engineering", "key": "ENG"},
        headers=owner["headers"],
    )
    assert team_response.status_code == 200
    team_id = team_response.json()["id"]

    active = client.get(f"/teams/{team_id}", headers=owner["headers"])
    assert active.status_code == 200
    assert "archived" in active.json()
    assert active.json()["archived"] is False

    archived = client.patch(
        f"/teams/{team_id}",
        json={"archived": True},
        headers=admin["headers"],
    )
    assert archived.status_code == 200
    assert "archived" in archived.json()
    assert archived.json()["archived"] is True


def test_a_team_admin_can_delete_an_empty_team(client, team):
    response = client.delete(f"/teams/{team['team']['id']}", headers=team["headers"])
    assert response.status_code == 204
    assert (
        client.get(f"/teams/{team['team']['id']}", headers=team["headers"]).status_code
        == 404
    )


def test_a_site_admin_can_delete_another_teams_empty_team(client, auth, admin):
    owner = auth(email="owner@softtrack.dev", full_name="Owner User")
    team_response = client.post(
        "/teams",
        json={"name": "Engineering", "key": "ENG"},
        headers=owner["headers"],
    )
    team_id = team_response.json()["id"]

    response = client.delete(f"/teams/{team_id}", headers=admin["headers"])
    assert response.status_code == 204


def test_a_member_cannot_delete_a_team(client, auth):
    owner = auth(email="owner@softtrack.dev", full_name="Owner User")
    member = auth(email="member@softtrack.dev", full_name="Member User")
    team_response = client.post(
        "/teams",
        json={"name": "Engineering", "key": "ENG"},
        headers=owner["headers"],
    )
    team_id = team_response.json()["id"]
    client.post(
        f"/teams/{team_id}/members",
        json={"email": member["user"]["email"], "role": "member"},
        headers=owner["headers"],
    )

    response = client.delete(f"/teams/{team_id}", headers=member["headers"])
    assert response.status_code == 403
    assert response.json()["code"] == "not_team_admin"


def test_a_guest_cannot_delete_a_team(client, auth):
    owner = auth(email="owner@softtrack.dev", full_name="Owner User")
    guest = auth(email="guest@softtrack.dev", full_name="Guest User")
    team_response = client.post(
        "/teams",
        json={"name": "Engineering", "key": "ENG"},
        headers=owner["headers"],
    )
    team_id = team_response.json()["id"]
    client.post(
        f"/teams/{team_id}/members",
        json={"email": guest["user"]["email"], "role": "guest"},
        headers=owner["headers"],
    )

    response = client.delete(f"/teams/{team_id}", headers=guest["headers"])
    assert response.status_code == 403
    assert response.json()["code"] == "not_team_admin"


def test_a_team_with_tickets_cannot_be_deleted(client, team):
    response = client.post(
        f"/teams/{team['team']['id']}/tickets",
        json={"title": "Must stay"},
        headers=team["headers"],
    )
    assert response.status_code == 200

    response = client.delete(f"/teams/{team['team']['id']}", headers=team["headers"])
    assert response.status_code == 409
    assert response.json()["code"] == "team_has_tickets"
    assert "archive" in response.json()["detail"]
    assert (
        client.get(f"/teams/{team['team']['id']}", headers=team["headers"]).status_code
        == 200
    )


def test_an_archived_empty_team_can_be_deleted(client, team):
    client.patch(
        f"/teams/{team['team']['id']}",
        json={"archived": True},
        headers=team["headers"],
    )

    response = client.delete(f"/teams/{team['team']['id']}", headers=team["headers"])
    assert response.status_code == 204
    assert (
        client.get(f"/teams/{team['team']['id']}", headers=team["headers"]).status_code
        == 404
    )


def test_a_team_with_a_default_saved_view_can_be_deleted(client, team, session):
    view_response = client.post(
        f"/teams/{team['team']['id']}/views",
        json={"name": "Default view", "is_shared": True, "filters": {}},
        headers=team["headers"],
    )
    assert view_response.status_code == 200
    view_id = view_response.json()["id"]
    team_row = session.get(Team, team["team"]["id"])
    team_row.default_view_id = view_id
    session.add(team_row)
    session.commit()

    response = client.delete(f"/teams/{team['team']['id']}", headers=team["headers"])
    assert response.status_code == 204
    assert session.get(Team, team["team"]["id"]) is None
    assert session.get(SavedView, view_id) is None
    assert (
        session.exec(
            select(UserDefaultView).where(UserDefaultView.team_id == team["team"]["id"])
        ).all()
        == []
    )


def test_a_team_with_webhook_deliveries_can_be_deleted(client, team, session):
    hook_response = client.post(
        f"/teams/{team['team']['id']}/outbound-webhooks",
        json={"url": "https://93.184.216.34/softtrack", "events": ["ticket.created"]},
        headers=team["headers"],
    )
    assert hook_response.status_code == 200
    hook_id = hook_response.json()["id"]

    session.add(
        WebhookDelivery(
            webhook_id=hook_id,
            event="ticket.created",
            payload='{"event":"ticket.created"}',
            status="pending",
        )
    )
    session.commit()

    response = client.delete(f"/teams/{team['team']['id']}", headers=team["headers"])
    assert response.status_code == 204
    assert session.get(OutboundWebhook, hook_id) is None
    assert (
        session.exec(
            select(WebhookDelivery).where(WebhookDelivery.webhook_id == hook_id)
        ).all()
        == []
    )


def test_a_team_with_custom_field_values_can_be_deleted(client, auth, session):
    owner = auth(email="owner@softtrack.dev", full_name="Owner User")
    team_response = client.post(
        "/teams",
        json={"name": "Engineering", "key": "ENG"},
        headers=owner["headers"],
    )
    team_id = team_response.json()["id"]
    field_response = client.post(
        f"/teams/{team_id}/custom-fields",
        json={
            "name": "Environment",
            "key": "environment",
            "kind": "select",
            "options": [{"name": "Dev"}],
        },
        headers=owner["headers"],
    )
    assert field_response.status_code == 200, field_response.text
    field_id = (
        session.exec(select(CustomField).where(CustomField.team_id == team_id)).one().id
    )

    other = auth(email="other@softtrack.dev", full_name="Other User")
    other_team = client.post(
        "/teams",
        json={"name": "Operations", "key": "OPS"},
        headers=other["headers"],
    )
    other_team_id = other_team.json()["id"]
    ticket = client.post(
        f"/teams/{other_team_id}/tickets",
        json={"title": "Other team work"},
        headers=other["headers"],
    )
    session.add(
        CustomFieldValue(
            ticket_id=ticket.json()["id"],
            field_id=field_id,
            value="dev",
        )
    )
    session.commit()

    response = client.delete(f"/teams/{team_id}", headers=owner["headers"])
    assert response.status_code == 204
    assert session.get(CustomField, field_id) is None
    assert (
        session.exec(
            select(CustomFieldValue).where(CustomFieldValue.field_id == field_id)
        ).all()
        == []
    )

"""Invitations: creating, resending, revoking, and the three ways one ends."""

from datetime import timedelta

import pytest
from sqlmodel import select

from lib_softtrack.tables import TeamInvite, utcnow


@pytest.fixture
def invited(client, team):
    """An open invitation to ada@softtrack.dev, from the team's admin."""
    response = client.post(
        f"/teams/{team['team']['id']}/invites",
        json={"email": "Ada@Softtrack.dev", "role": "member"},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return {**team, "invite": response.json()}


def test_creating_an_invite_returns_a_link_token(invited):
    invite = invited["invite"]
    # Lowercased on the way in, so re-inviting the same person in a different
    # case refreshes the invitation rather than making a second one.
    assert invite["email"] == "ada@softtrack.dev"
    assert invite["role"] == "member"
    assert len(invite["token"]) > 20
    assert invite["invited_by"]["email"] == "demo@softtrack.dev"
    assert invite["team_key"] == "ENG"


def test_a_pending_invite_is_listed(client, invited):
    response = client.get(
        f"/teams/{invited['team']['id']}/invites", headers=invited["headers"]
    )
    assert response.status_code == 200
    assert [i["email"] for i in response.json()] == ["ada@softtrack.dev"]


def test_only_admins_see_or_send_invites(client, team, auth):
    member = auth(email="member@softtrack.dev")
    client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": "member@softtrack.dev"},
        headers=team["headers"],
    )
    assert (
        client.get(
            f"/teams/{team['team']['id']}/invites", headers=member["headers"]
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/teams/{team['team']['id']}/invites",
            json={"email": "someone@softtrack.dev"},
            headers=member["headers"],
        ).status_code
        == 403
    )


def test_reinviting_refreshes_the_token(client, invited):
    first = invited["invite"]
    again = client.post(
        f"/teams/{invited['team']['id']}/invites",
        json={"email": "ada@softtrack.dev", "role": "admin"},
        headers=invited["headers"],
    )
    assert again.status_code == 200
    assert again.json()["id"] == first["id"]
    assert again.json()["token"] != first["token"]
    assert again.json()["role"] == "admin"

    # Still exactly one pending invitation for that address.
    listed = client.get(
        f"/teams/{invited['team']['id']}/invites", headers=invited["headers"]
    ).json()
    assert len(listed) == 1

    # And the superseded link is dead.
    assert client.get(f"/invites/{first['token']}").status_code == 404


def test_inviting_an_existing_member_is_refused(client, team, auth):
    auth(email="already@softtrack.dev")
    client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": "already@softtrack.dev"},
        headers=team["headers"],
    )
    response = client.post(
        f"/teams/{team['team']['id']}/invites",
        json={"email": "already@softtrack.dev"},
        headers=team["headers"],
    )
    assert response.status_code == 400


def test_revoking_an_invite(client, invited):
    team_id = invited["team"]["id"]
    response = client.delete(
        f"/teams/{team_id}/invites/{invited['invite']['id']}",
        headers=invited["headers"],
    )
    assert response.status_code == 204
    assert (
        client.get(f"/teams/{team_id}/invites", headers=invited["headers"]).json() == []
    )
    assert client.get(f"/invites/{invited['invite']['token']}").status_code == 404


def test_revoking_another_teams_invite_is_a_404(client, invited, auth):
    """Admin of one team, invite id from another: the team is part of the lookup."""
    other = auth(email="other-admin@softtrack.dev")
    other_team = client.post(
        "/teams", json={"name": "Design", "key": "DSN"}, headers=other["headers"]
    ).json()
    response = client.delete(
        f"/teams/{other_team['id']}/invites/{invited['invite']['id']}",
        headers=other["headers"],
    )
    assert response.status_code == 404


def test_the_preview_is_public_and_says_enough_to_decide(client, invited):
    response = client.get(f"/invites/{invited['invite']['token']}")
    assert response.status_code == 200
    body = response.json()
    assert body["team_name"] == "Engineering"
    assert body["team_key"] == "ENG"
    assert body["email"] == "ada@softtrack.dev"
    assert body["role"] == "member"
    assert body["invited_by_name"] == "Demo User"


def test_an_unknown_token_previews_as_404(client):
    assert client.get("/invites/not-a-real-token").status_code == 404


def test_accepting_joins_the_team_with_the_invited_role(client, invited, auth):
    ada = auth(email="ada@softtrack.dev", full_name="Ada Lovelace")
    response = client.post(
        f"/invites/{invited['invite']['token']}/accept", headers=ada["headers"]
    )
    assert response.status_code == 200
    assert response.json()["key"] == "ENG"

    members = client.get(
        f"/teams/{invited['team']['id']}/members", headers=invited["headers"]
    ).json()
    ada_row = next(m for m in members if m["user"]["email"] == "ada@softtrack.dev")
    assert ada_row["role"] == "member"

    # Spent: the link cannot be used twice.
    assert client.get(f"/invites/{invited['invite']['token']}").status_code == 404


def test_accepting_an_admin_invite_grants_admin(client, team, auth):
    invite = client.post(
        f"/teams/{team['team']['id']}/invites",
        json={"email": "boss@softtrack.dev", "role": "admin"},
        headers=team["headers"],
    ).json()
    boss = auth(email="boss@softtrack.dev")
    client.post(f"/invites/{invite['token']}/accept", headers=boss["headers"])

    assert (
        client.patch(
            f"/teams/{team['team']['id']}",
            json={"name": "Renamed"},
            headers=boss["headers"],
        ).status_code
        == 200
    )


def test_a_forwarded_link_does_not_admit_the_wrong_person(client, invited, auth):
    someone_else = auth(email="eve@softtrack.dev")
    response = client.post(
        f"/invites/{invited['invite']['token']}/accept",
        headers=someone_else["headers"],
    )
    assert response.status_code == 403
    assert "different email address" in response.json()["detail"]


def test_an_expired_invite_is_gone(client, invited, session, auth):
    invite = session.exec(
        select(TeamInvite).where(TeamInvite.token == invited["invite"]["token"])
    ).one()
    invite.expires_at = utcnow() - timedelta(seconds=1)
    session.add(invite)
    session.commit()

    assert client.get(f"/invites/{invite.token}").status_code == 404
    ada = auth(email="ada@softtrack.dev")
    assert (
        client.post(
            f"/invites/{invite.token}/accept", headers=ada["headers"]
        ).status_code
        == 404
    )


def test_listing_prunes_expired_invites(client, invited, session):
    invite = session.exec(select(TeamInvite)).one()
    invite.expires_at = utcnow() - timedelta(seconds=1)
    session.add(invite)
    session.commit()

    listed = client.get(
        f"/teams/{invited['team']['id']}/invites", headers=invited["headers"]
    ).json()
    assert listed == []
    assert session.exec(select(TeamInvite)).all() == []


def test_declining_deletes_the_invite(client, invited, auth):
    ada = auth(email="ada@softtrack.dev")
    response = client.post(
        f"/invites/{invited['invite']['token']}/decline", headers=ada["headers"]
    )
    assert response.status_code == 204
    assert (
        client.get(
            f"/teams/{invited['team']['id']}/invites", headers=invited["headers"]
        ).json()
        == []
    )
    assert client.get("/teams", headers=ada["headers"]).json() == []


def test_my_invites_lists_the_ones_addressed_to_me(client, invited, auth):
    ada = auth(email="ada@softtrack.dev")
    mine = client.get("/auth/me/invites", headers=ada["headers"]).json()
    assert [i["team_key"] for i in mine] == ["ENG"]
    assert mine[0]["token"] == invited["invite"]["token"]

    stranger = auth(email="nobody@softtrack.dev")
    assert client.get("/auth/me/invites", headers=stranger["headers"]).json() == []


def test_registering_with_an_invite_token_joins_the_team(client, invited):
    response = client.post(
        "/auth/register",
        json={
            "email": "ada@softtrack.dev",
            "password": "password123",
            "full_name": "Ada Lovelace",
            "invite_token": invited["invite"]["token"],
        },
    )
    assert response.status_code == 200, response.text
    headers = {"Authorization": f"Bearer {response.json()['access_token']}"}
    assert [t["key"] for t in client.get("/teams", headers=headers).json()] == ["ENG"]


def test_registering_with_a_stale_invite_token_still_creates_the_account(
    client, invited
):
    """A dead link should not cost someone the account they just signed up for."""
    response = client.post(
        "/auth/register",
        json={
            "email": "ada@softtrack.dev",
            "password": "password123",
            "full_name": "Ada Lovelace",
            "invite_token": "not-a-real-token",
        },
    )
    assert response.status_code == 200
    headers = {"Authorization": f"Bearer {response.json()['access_token']}"}
    assert client.get("/teams", headers=headers).json() == []
    # The real invitation is still waiting for them.
    assert len(client.get("/auth/me/invites", headers=headers).json()) == 1


def test_auth_config_reports_open_registration(client):
    assert client.get("/auth/config").json()["open_registration"] is True


def test_a_closed_instance_refuses_an_uninvited_signup(client, invited, monkeypatch):
    from web import settings

    monkeypatch.setattr(settings, "open_registration", False)
    assert client.get("/auth/config").json()["open_registration"] is False

    refused = client.post(
        "/auth/register",
        json={
            "email": "stranger@softtrack.dev",
            "password": "password123",
            "full_name": "Stranger",
        },
    )
    assert refused.status_code == 403
    assert refused.json()["detail"] == "Registration on this SoftTrack is by invitation"


def test_a_closed_instance_accepts_an_invited_signup(client, invited, monkeypatch):
    from web import settings

    monkeypatch.setattr(settings, "open_registration", False)
    response = client.post(
        "/auth/register",
        json={
            "email": "ada@softtrack.dev",
            "password": "password123",
            "full_name": "Ada Lovelace",
            "invite_token": invited["invite"]["token"],
        },
    )
    assert response.status_code == 200, response.text
    headers = {"Authorization": f"Bearer {response.json()['access_token']}"}
    assert [t["key"] for t in client.get("/teams", headers=headers).json()] == ["ENG"]

"""Read-only share links for an epic or a saved view (#245).

A team admin makes a link; whoever has it sees the epic's tickets -- key,
title, status, type -- and its progress, without signing in. The rest is off
unless the link turns it on. Only the token's hash is kept; a link can
expire, ask for a password and be revoked; and every link that does not work
answers the same.
"""

import io
from datetime import timedelta

import pytest
from sqlmodel import select

from lib_softtrack.tables import ShareLink, utcnow

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def _ok(response):
    assert response.status_code in (200, 201), response.text
    return response.json()


@pytest.fixture
def portal(client, team, auth):
    """Engineering's Customer portal epic: two tickets in it, one elsewhere,
    one of them finished, assigned, estimated, discussed and with a file."""
    team_id = team["team"]["id"]
    h = team["headers"]
    epic = _ok(
        client.post(
            f"/teams/{team_id}/projects",
            json={"name": "Customer portal", "description": "Invoices and sign-in."},
            headers=h,
        )
    )
    sign_in = _ok(
        client.post(
            f"/teams/{team_id}/tickets",
            json={
                "title": "Portal: sign-in with magic link",
                "project_id": epic["id"],
                "assignee_id": team["user"]["id"],
                "estimate": 5,
            },
            headers=h,
        )
    )
    branding = _ok(
        client.post(
            f"/teams/{team_id}/tickets",
            json={"title": "Portal: branding", "project_id": epic["id"]},
            headers=h,
        )
    )
    _ok(
        client.patch(
            f"/tickets/{branding['id']}",
            json={"status_id": team["status_ids"]["Done"]},
            headers=h,
        )
    )
    elsewhere = _ok(
        client.post(
            f"/teams/{team_id}/tickets", json={"title": "Salary bands"}, headers=h
        )
    )
    _ok(
        client.post(
            f"/tickets/{sign_in['id']}/comments",
            json={"body": "Magic links expire after 15 minutes."},
            headers=h,
        )
    )
    _ok(
        client.post(
            f"/tickets/{sign_in['id']}/worklogs", json={"minutes": 90}, headers=h
        )
    )
    attachment = _ok(
        client.post(
            f"/tickets/{sign_in['id']}/attachments",
            files={"file": ("flow.png", io.BytesIO(PNG), "image/png")},
            headers=h,
        )
    )
    return {
        **team,
        "team_id": team_id,
        "epic": epic,
        "sign_in": sign_in,
        "branding": branding,
        "elsewhere": elsewhere,
        "attachment": attachment,
    }


def share(client, portal, **fields):
    body = {"project_id": portal["epic"]["id"], **fields}
    return client.post(
        f"/teams/{portal['team_id']}/share-links", json=body, headers=portal["headers"]
    )


def open_page(client, token, password=None):
    headers = {"X-Share-Password": password} if password else {}
    return client.get(f"/shared/{token}", headers=headers)


def test_whoever_has_the_link_sees_the_epic_without_signing_in(client, portal):
    created = _ok(share(client, portal))
    response = open_page(client, created["token"])
    assert response.status_code == 200, response.text
    assert response.headers["X-Robots-Tag"] == "noindex, nofollow"
    page = response.json()
    assert page["team_name"] == "Engineering"
    assert page["kind"] == "epic"
    assert page["title"] == "Customer portal"
    assert page["description"] == "Invoices and sign-in."
    assert (page["completed_ticket_count"], page["ticket_count"]) == (1, 2)
    # Open work first, then what is done; nothing from outside the epic.
    assert [t["title"] for t in page["tickets"]] == [
        "Portal: sign-in with magic link",
        "Portal: branding",
    ]
    first = page["tickets"][0]
    assert first["identifier"] == f"ENG-{portal['sign_in']['number']}"
    assert first["status"]["name"] == "Backlog"
    assert first["type"] == "task"


def test_the_rest_is_off_unless_the_link_turns_it_on(client, portal):
    plain = open_page(client, _ok(share(client, portal))["token"]).json()
    first = plain["tickets"][0]
    assert first["assignee"] is None
    assert first["estimate"] is None and first["minutes_logged"] is None
    assert first["comments"] is None and first["attachments"] is None
    assert "demo@softtrack.dev" not in str(plain)

    everything = _ok(
        share(
            client,
            portal,
            shows={
                "comments": True,
                "assignees": True,
                "estimates": True,
                "attachments": True,
            },
        )
    )
    first = open_page(client, everything["token"]).json()["tickets"][0]
    assert first["assignee"] == "Demo User"
    assert (first["estimate"], first["minutes_logged"]) == (5, 90)
    assert [c["body"] for c in first["comments"]] == [
        "Magic links expire after 15 minutes."
    ]
    assert first["comments"][0]["author"] == "Demo User"
    assert [a["filename"] for a in first["attachments"]] == ["flow.png"]


def test_a_file_downloads_only_through_a_link_that_shows_files(client, portal):
    path = "/shared/{token}/attachments/" + str(portal["attachment"]["id"])
    without = _ok(share(client, portal))["token"]
    assert client.get(path.format(token=without)).status_code == 404

    with_files = _ok(share(client, portal, shows={"attachments": True}))["token"]
    response = client.get(path.format(token=with_files))
    assert response.status_code == 200, response.text
    assert response.content == PNG


def test_a_saved_view_is_shared_by_its_filters(client, portal):
    view = _ok(
        client.post(
            f"/teams/{portal['team_id']}/views",
            json={
                "name": "Portal, still open",
                "is_shared": True,
                "filters": {
                    "project_id": portal["epic"]["id"],
                    "status_id": portal["status_ids"]["Backlog"],
                },
            },
            headers=portal["headers"],
        )
    )
    created = _ok(share(client, portal, project_id=None, view_id=view["id"]))
    assert created["link"]["kind"] == "view"
    page = open_page(client, created["token"]).json()
    assert page["title"] == "Portal, still open"
    assert [t["title"] for t in page["tickets"]] == ["Portal: sign-in with magic link"]


def test_only_the_tokens_hash_is_kept(client, portal, session):
    created = _ok(share(client, portal))
    stored = session.exec(select(ShareLink)).one()
    assert created["token"] not in stored.token_hash
    assert len(stored.token_hash) == 64
    assert "token" not in created["link"]


def test_a_password_is_asked_for_and_checked(client, portal):
    token = _ok(share(client, portal, password="portal-2026"))["token"]
    asked = open_page(client, token)
    assert asked.status_code == 401
    assert asked.json()["code"] == "share_password_required"
    wrong = open_page(client, token, "guess")
    assert wrong.status_code == 401
    assert wrong.json()["code"] == "share_password_wrong"
    assert open_page(client, token, "portal-2026").status_code == 200


def test_revoked_expired_and_unknown_links_answer_alike(client, portal, session):
    revoked = _ok(share(client, portal))
    assert (
        client.delete(
            f"/share-links/{revoked['link']['id']}", headers=portal["headers"]
        ).status_code
        == 204
    )
    expired = _ok(share(client, portal, expires_in_days=1))
    row = session.get(ShareLink, expired["link"]["id"])
    row.expires_at = utcnow() - timedelta(minutes=1)
    session.add(row)
    session.commit()

    answers = [
        open_page(client, revoked["token"]),
        open_page(client, expired["token"]),
        open_page(client, "never-a-link"),
    ]
    assert {r.status_code for r in answers} == {404}
    assert {r.text for r in answers} == {
        '{"detail":"This link is no longer active","code":"share_link_inactive"}'
    }


def test_the_list_says_who_made_each_and_how_often_it_was_opened(client, portal):
    created = _ok(share(client, portal, expires_in_days=30, password="pw-1234"))
    for _ in range(3):
        open_page(client, created["token"], "pw-1234")
    links = _ok(
        client.get(f"/teams/{portal['team_id']}/share-links", headers=portal["headers"])
    )
    assert len(links) == 1
    link = links[0]
    assert link["target_name"] == "Customer portal"
    assert link["created_by"]["full_name"] == "Demo User"
    assert link["open_count"] == 3
    assert link["last_opened_at"] is not None
    assert link["has_password"] is True
    assert link["expires_at"] is not None
    assert link["active"] is True


def test_only_a_team_admin_makes_lists_or_revokes_them(client, portal, auth):
    member = auth(email="daniel@softtrack.dev", full_name="Daniel Okafor")
    _ok(
        client.post(
            f"/teams/{portal['team_id']}/members",
            json={"email": "daniel@softtrack.dev", "role": "member"},
            headers=portal["headers"],
        )
    )
    created = _ok(share(client, portal))
    for response in (
        client.post(
            f"/teams/{portal['team_id']}/share-links",
            json={"project_id": portal["epic"]["id"]},
            headers=member["headers"],
        ),
        client.get(
            f"/teams/{portal['team_id']}/share-links", headers=member["headers"]
        ),
        client.delete(
            f"/share-links/{created['link']['id']}", headers=member["headers"]
        ),
    ):
        assert response.status_code == 403, response.text


def test_a_link_is_for_an_epic_or_a_view_and_exactly_one(client, portal):
    for body in ({}, {"project_id": portal["epic"]["id"], "view_id": 1}):
        response = client.post(
            f"/teams/{portal['team_id']}/share-links",
            json=body,
            headers=portal["headers"],
        )
        assert response.status_code == 400
        assert response.json()["code"] == "share_target_required"


def test_an_epic_in_the_trash_stops_its_links_and_a_purge_revokes_them(client, portal):
    token = _ok(share(client, portal))["token"]
    epic_id = portal["epic"]["id"]
    h = portal["headers"]
    assert client.delete(f"/projects/{epic_id}", headers=h).status_code == 204
    assert open_page(client, token).status_code == 404
    assert client.delete(f"/trash/projects/{epic_id}", headers=h).status_code == 204
    links = _ok(client.get(f"/teams/{portal['team_id']}/share-links", headers=h))
    assert links[0]["revoked_at"] is not None
    assert links[0]["target_name"] is None


def test_deleting_a_view_revokes_its_links(client, portal):
    h = portal["headers"]
    view = _ok(
        client.post(
            f"/teams/{portal['team_id']}/views",
            json={"name": "Mine", "is_shared": True, "filters": {}},
            headers=h,
        )
    )
    token = _ok(share(client, portal, project_id=None, view_id=view["id"]))["token"]
    assert client.delete(f"/views/{view['id']}", headers=h).status_code == 204
    assert open_page(client, token).status_code == 404


def test_guessing_at_tokens_is_throttled(client, portal):
    for _ in range(10):
        assert open_page(client, "guess").status_code == 404
    limited = open_page(client, "guess")
    assert limited.status_code == 429
    assert limited.json()["code"] == "rate_limited"

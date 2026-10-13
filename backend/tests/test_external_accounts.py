"""An account from outside the organisation, limited to its epics (#243).

A client is invited as a guest "from outside", with the epics they may see.
Their account is external from its first sign-in, they are only ever a
guest, and on the team they see the tickets of those epics and nothing else
-- for their account, the rest do not exist. The sweep at the bottom sends
every read route as one and looks for anything out of reach in the answers.
"""

import io
import re

import pytest

from main import app

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
HIDDEN = "HIDDEN"


def _ok(response):
    assert response.status_code in (200, 201), response.text
    return response.json()


@pytest.fixture
def eng(client, team):
    """Engineering with two epics, and tickets in each and in neither.

    Everything Carlos must never see carries HIDDEN in its text.
    """
    team_id = team["team"]["id"]
    h = team["headers"]

    def post(path, **kwargs):
        return _ok(client.post(path, headers=h, **kwargs))

    portal = post(f"/teams/{team_id}/projects", json={"name": "Customer portal"})
    internal = post(f"/teams/{team_id}/projects", json={"name": f"{HIDDEN} ops"})
    sign_in = post(
        f"/teams/{team_id}/tickets",
        json={"title": "Portal: sign-in with magic link", "project_id": portal["id"]},
    )
    secret = post(
        f"/teams/{team_id}/tickets",
        json={
            "title": f"{HIDDEN} salary bands",
            "description": f"{HIDDEN} description",
            "project_id": internal["id"],
        },
    )
    loose = post(f"/teams/{team_id}/tickets", json={"title": f"{HIDDEN} loose"})
    return {
        **team,
        "team_id": team_id,
        "portal": portal,
        "internal": internal,
        "sign_in": sign_in,
        "secret": secret,
        "loose": loose,
    }


def invite(client, eng, email, **fields):
    return client.post(
        f"/teams/{eng['team_id']}/invites",
        json={"email": email, "role": "guest", **fields},
        headers=eng["headers"],
    )


def join_from_outside(client, eng, email, name, epic_ids):
    """Invited from outside, then registered from the link."""
    token = _ok(invite(client, eng, email, external=True, epic_ids=epic_ids))["token"]
    body = _ok(
        client.post(
            "/auth/register",
            json={
                "email": email,
                "password": "password123",
                "full_name": name,
                "invite_token": token,
            },
        )
    )
    return {
        "user": body["user"],
        "headers": {"Authorization": f"Bearer {body['access_token']}"},
    }


@pytest.fixture
def carlos(client, eng):
    return join_from_outside(
        client, eng, "carlos@acme-retail.com", "Carlos Rivera", [eng["portal"]["id"]]
    )


def titles(client, eng, actor):
    page = _ok(client.get(f"/teams/{eng['team_id']}/tickets", headers=actor["headers"]))
    return sorted(ticket["title"] for ticket in page["items"])


# --- becoming one -------------------------------------------------------------


def test_the_invitation_makes_the_account_external_and_a_guest(client, eng, carlos):
    assert carlos["user"]["is_external"] is True
    members = _ok(
        client.get(f"/teams/{eng['team_id']}/members", headers=eng["headers"])
    )
    row = next(m for m in members if m["user"]["id"] == carlos["user"]["id"])
    assert row["role"] == "guest"
    assert row["user"]["is_external"] is True
    assert [epic["name"] for epic in row["epics"]] == ["Customer portal"]
    # Everybody else is inside, and has no epics listed: they see them all.
    owner = next(m for m in members if m["user"]["id"] == eng["user"]["id"])
    assert owner["user"]["is_external"] is False
    assert owner["epics"] == []


def test_somebody_from_outside_is_only_ever_a_guest(client, eng):
    refused = invite(client, eng, "x@acme-retail.com", role="member", external=True)
    assert refused.status_code == 400
    assert refused.json()["code"] == "external_account_is_guest"


def test_epics_are_only_for_somebody_from_outside(client, eng):
    refused = invite(client, eng, "x@softtrack.dev", epic_ids=[eng["portal"]["id"]])
    assert refused.status_code == 400
    assert refused.json()["code"] == "epics_only_for_external"


def test_an_epic_has_to_be_the_teams(client, eng, auth):
    other = auth(email="ops@softtrack.dev", full_name="Ops Lead")
    ops = _ok(
        client.post(
            "/teams", json={"name": "Ops", "key": "OPS"}, headers=other["headers"]
        )
    )
    theirs = _ok(
        client.post(
            f"/teams/{ops['id']}/projects",
            json={"name": "Theirs"},
            headers=other["headers"],
        )
    )
    refused = invite(
        client, eng, "x@acme-retail.com", external=True, epic_ids=[theirs["id"]]
    )
    assert refused.status_code == 400
    assert refused.json()["code"] == "not_on_this_team"


def test_an_account_inside_is_not_made_external_by_an_invitation(client, eng, auth):
    auth(email="sofia@softtrack.dev", full_name="Sofia Marin")
    refused = invite(client, eng, "sofia@softtrack.dev", external=True)
    assert refused.status_code == 400
    assert refused.json()["code"] == "account_inside_organisation"


def test_an_account_from_outside_is_invited_as_one(client, eng, carlos, auth):
    other = auth(email="ops@softtrack.dev", full_name="Ops Lead")
    ops = _ok(
        client.post(
            "/teams", json={"name": "Ops", "key": "OPS"}, headers=other["headers"]
        )
    )
    refused = client.post(
        f"/teams/{ops['id']}/invites",
        json={"email": "carlos@acme-retail.com", "role": "guest"},
        headers=other["headers"],
    )
    assert refused.status_code == 400
    assert refused.json()["code"] == "account_outside_organisation"


def test_the_invitation_lists_what_it_gives(client, eng):
    _ok(
        invite(
            client,
            eng,
            "hana@brightline.co",
            external=True,
            epic_ids=[eng["portal"]["id"]],
        )
    )
    pending = _ok(
        client.get(f"/teams/{eng['team_id']}/invites", headers=eng["headers"])
    )
    assert pending[0]["external"] is True
    assert [epic["name"] for epic in pending[0]["epics"]] == ["Customer portal"]


def test_an_external_guest_cannot_be_made_a_member(client, eng, carlos):
    refused = client.patch(
        f"/teams/{eng['team_id']}/members/{carlos['user']['id']}",
        json={"role": "member"},
        headers=eng["headers"],
    )
    assert refused.status_code == 400
    assert refused.json()["code"] == "external_account_is_guest"


# --- what they see ------------------------------------------------------------


def test_they_see_the_tickets_of_their_epics_and_nothing_else(client, eng, carlos):
    assert titles(client, eng, carlos) == ["Portal: sign-in with magic link"]
    # The owner, inside, still sees all three.
    assert len(titles(client, eng, eng)) == 3

    projects = _ok(
        client.get(f"/teams/{eng['team_id']}/projects", headers=carlos["headers"])
    )
    assert [project["name"] for project in projects] == ["Customer portal"]


def test_a_ticket_outside_their_epics_answers_as_it_would_a_stranger(
    client, eng, carlos, auth
):
    stranger = auth(email="nobody@softtrack.dev", full_name="Nobody")
    for path in (
        f"/tickets/{eng['secret']['id']}",
        f"/tickets/{eng['loose']['id']}",
        f"/teams/{eng['team_id']}/tickets/by-number/{eng['secret']['number']}",
        f"/projects/{eng['internal']['id']}",
    ):
        theirs = client.get(path, headers=carlos["headers"])
        assert theirs.status_code == 404, (path, theirs.text)
        assert HIDDEN not in theirs.text
    # A stranger is told the ticket is not theirs to see in the same words.
    assert (
        client.get(f"/tickets/{eng['secret']['id']}", headers=carlos["headers"]).json()[
            "code"
        ]
        == "ticket_not_found"
    )
    assert client.get(
        f"/tickets/{eng['sign_in']['id']}", headers=stranger["headers"]
    ).status_code in (403, 404)


def test_no_epic_means_no_tickets(client, eng):
    nobody = join_from_outside(client, eng, "hana@brightline.co", "Hana Suzuki", [])
    assert titles(client, eng, nobody) == []


def test_two_accounts_from_outside_each_see_their_own(client, eng, carlos):
    hana = join_from_outside(
        client, eng, "hana@brightline.co", "Hana Suzuki", [eng["internal"]["id"]]
    )
    assert titles(client, eng, hana) == [f"{HIDDEN} salary bands"]
    assert titles(client, eng, carlos) == ["Portal: sign-in with magic link"]
    assert titles(client, eng, hana) == [f"{HIDDEN} salary bands"]


def test_search_finds_only_what_they_can_see(client, eng, carlos):
    for query in ("salary", "Portal"):
        response = client.get(
            "/search",
            params={"q": query, "team_id": eng["team_id"]},
            headers=carlos["headers"],
        )
        assert response.status_code == 200, response.text
        assert HIDDEN not in response.text


def test_changing_their_epics_changes_what_they_see(client, eng, carlos):
    response = client.patch(
        f"/teams/{eng['team_id']}/members/{carlos['user']['id']}",
        json={"epic_ids": [eng["portal"]["id"], eng["internal"]["id"]]},
        headers=eng["headers"],
    )
    assert response.status_code == 200, response.text
    assert [epic["name"] for epic in response.json()["epics"]] == [
        "Customer portal",
        f"{HIDDEN} ops",
    ]
    assert len(titles(client, eng, carlos)) == 2


def test_somebody_inside_is_not_given_epics(client, eng, auth):
    daniel = auth(email="daniel@softtrack.dev", full_name="Daniel Okafor")
    _ok(
        client.post(
            f"/teams/{eng['team_id']}/members",
            json={"email": "daniel@softtrack.dev", "role": "member"},
            headers=eng["headers"],
        )
    )
    refused = client.patch(
        f"/teams/{eng['team_id']}/members/{daniel['user']['id']}",
        json={"epic_ids": [eng["portal"]["id"]]},
        headers=eng["headers"],
    )
    assert refused.status_code == 400
    assert refused.json()["code"] == "epics_only_for_external"


def test_leaving_takes_the_epics_with_the_membership(client, eng, carlos):
    response = client.delete(
        f"/teams/{eng['team_id']}/members/{carlos['user']['id']}",
        headers=eng["headers"],
    )
    assert response.status_code == 204, response.text
    # Back on the team, they are given nothing they had before.
    _ok(
        client.post(
            f"/teams/{eng['team_id']}/members",
            json={"email": "carlos@acme-retail.com", "role": "guest"},
            headers=eng["headers"],
        )
    )
    assert titles(client, eng, carlos) == []


def test_a_purged_epic_is_taken_from_them(client, eng, carlos):
    assert (
        client.delete(
            f"/projects/{eng['portal']['id']}", headers=eng["headers"]
        ).status_code
        == 204
    )
    assert (
        client.delete(
            f"/trash/projects/{eng['portal']['id']}", headers=eng["headers"]
        ).status_code
        == 204
    )
    members = _ok(
        client.get(f"/teams/{eng['team_id']}/members", headers=eng["headers"])
    )
    row = next(m for m in members if m["user"]["id"] == carlos["user"]["id"])
    assert row["epics"] == []


def test_a_mention_reaches_them_only_where_they_can_see(client, eng, carlos):
    handle = carlos["user"]["username"]
    for ticket in (eng["secret"], eng["sign_in"]):
        _ok(
            client.post(
                f"/tickets/{ticket['id']}/comments",
                json={"body": f"@{handle} what do you think?"},
                headers=eng["headers"],
            )
        )
    inbox = _ok(client.get("/notifications", headers=carlos["headers"]))
    assert [n["ticket"]["id"] for n in inbox["items"]] == [eng["sign_in"]["id"]]


# --- the site admin -----------------------------------------------------------


def test_a_site_admin_marks_an_account_as_outside(client, eng, auth):
    sofia = auth(email="sofia@softtrack.dev", full_name="Sofia Marin")
    _ok(
        client.post(
            f"/teams/{eng['team_id']}/members",
            json={"email": "sofia@softtrack.dev", "role": "member"},
            headers=eng["headers"],
        )
    )
    path = f"/admin/users/{sofia['user']['id']}"
    refused = client.patch(path, json={"is_external": True}, headers=eng["headers"])
    assert refused.status_code == 409
    assert refused.json()["code"] == "external_account_is_guest"
    assert "Engineering" in refused.json()["detail"]

    _ok(
        client.patch(
            f"/teams/{eng['team_id']}/members/{sofia['user']['id']}",
            json={"role": "guest"},
            headers=eng["headers"],
        )
    )
    marked = _ok(client.patch(path, json={"is_external": True}, headers=eng["headers"]))
    assert marked["is_external"] is True
    assert marked["guest_of"] == [
        {
            "team_id": eng["team_id"],
            "team_name": "Engineering",
            "team_key": "ENG",
            "epics": [],
        }
    ]
    # Never an admin of any kind.
    refused = client.patch(
        path, json={"is_finance_admin": True}, headers=eng["headers"]
    )
    assert refused.status_code == 400
    assert refused.json()["code"] == "external_cannot_administer"
    # And nothing is visible until somebody gives them an epic.
    assert titles(client, eng, sofia) == []


def test_the_directory_filters_to_accounts_from_outside(client, eng, carlos):
    page = _ok(
        client.get("/admin/users", params={"role": "external"}, headers=eng["headers"])
    )
    assert [row["full_name"] for row in page["items"]] == ["Carlos Rivera"]
    assert page["items"][0]["guest_of"][0]["epics"] == ["Customer portal"]


def test_a_site_admin_is_never_from_outside(client, eng):
    refused = client.patch(
        f"/admin/users/{eng['user']['id']}",
        json={"is_external": True},
        headers=eng["headers"],
    )
    assert refused.status_code == 400
    assert refused.json()["code"] == "external_cannot_administer"


# --- the sweep ----------------------------------------------------------------


#: Read routes the sweep does not call: a stream that never ends.
NOT_SWEPT = {"/teams/{team_id}/events"}


def _read_routes() -> list[str]:
    return sorted(
        path
        for path, operations in app.openapi()["paths"].items()
        if "get" in operations and path not in NOT_SWEPT
    )


READS = _read_routes()


@pytest.fixture
def reachable(client, eng, carlos):
    """One of every row a read route can name, out of Carlos's reach and in
    it. Everything out of reach carries HIDDEN in its text."""
    h = eng["headers"]

    def post(path, **kwargs):
        return _ok(client.post(path, headers=h, **kwargs))

    secret, sign_in = eng["secret"], eng["sign_in"]
    for ticket in (secret, sign_in):
        post(
            f"/tickets/{ticket['id']}/comments",
            json={"body": f"{HIDDEN} comment" if ticket is secret else "Fine"},
        )
        post(f"/tickets/{ticket['id']}/worklogs", json={"minutes": 30})
    hidden_file = post(
        f"/tickets/{secret['id']}/attachments",
        files={"file": (f"{HIDDEN}.png", io.BytesIO(PNG), "image/png")},
    )
    # A link from what he sees to what he does not.
    post(
        f"/tickets/{sign_in['id']}/links",
        json={"target_id": secret["id"], "type": "relates_to"},
    )
    sprint = post(
        f"/teams/{eng['team_id']}/sprints",
        json={
            "name": "Sprint",
            "starts_at": "2026-10-01",
            "ends_at": "2026-10-14",
        },
    )
    for ticket in (secret, sign_in):
        _ok(
            client.patch(
                f"/tickets/{ticket['id']}",
                json={
                    "sprint_id": sprint["id"],
                    "status_id": eng["status_ids"]["Done"],
                },
                headers=h,
            )
        )
    common = {
        "team_id": eng["team_id"],
        "sprint_id": sprint["id"],
        "username": eng["user"]["username"],
    }
    return {
        "hidden": {
            **common,
            "ticket_id": secret["id"],
            "number": secret["number"],
            "project_id": eng["internal"]["id"],
            "attachment_id": hidden_file["id"],
        },
        "visible": {
            **common,
            "ticket_id": sign_in["id"],
            "number": sign_in["number"],
            "project_id": eng["portal"]["id"],
            "attachment_id": hidden_file["id"],
        },
    }


@pytest.mark.parametrize("path", READS, ids=READS)
@pytest.mark.parametrize("reach", ["hidden", "visible"])
def test_no_read_route_shows_them_anything_out_of_reach(
    client, carlos, reachable, path, reach
):
    """Every read route, as Carlos, naming rows out of his reach and in it:
    whatever it answers, nothing out of reach is in it, and it is never a
    500 -- a ticket that does not exist for him is not a crash either."""
    names = re.findall(r"{(\w+)}", path)
    values = reachable[reach]
    url = path.format(**{name: values.get(name, 0) for name in names})

    response = client.get(url, headers=carlos["headers"])

    assert response.status_code < 500, (url, response.text)
    assert HIDDEN not in response.content.decode("utf-8", "ignore"), (
        url,
        response.text[:500],
    )


def test_the_sweep_is_not_vacuous(client, eng, carlos, reachable):
    """What the sweep looks for is there to be found, and what he may see
    still reaches him."""
    hidden, visible = reachable["hidden"], reachable["visible"]
    for path in (
        f"/tickets/{hidden['ticket_id']}",
        f"/teams/{eng['team_id']}/tickets/export",
        f"/tickets/{hidden['ticket_id']}/comments",
    ):
        assert HIDDEN in client.get(path, headers=eng["headers"]).text, path
    for path in (
        f"/tickets/{visible['ticket_id']}",
        f"/tickets/{visible['ticket_id']}/comments",
        f"/projects/{visible['project_id']}/burnup",
    ):
        assert client.get(path, headers=carlos["headers"]).status_code == 200, path
    assert len(READS) > 70

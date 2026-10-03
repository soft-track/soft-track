"""What an account from outside the organisation reaches beyond its teams (#317).

Its teams it reaches as #243 says: as a guest, confined to its epics. Beside
them, every route here asked only "is somebody signed in", which was the right
question while every account was a colleague's. An account from outside gets
its own account, its invitations and its notifications, and is refused the
directory, departments, workloads, the team directory, creating a team and
claiming expenses. It sees people by name and never by address.

The sweep at the bottom sends every route in the schema that is not about one
team's work as such an account, and fails on a route nobody has decided about.
"""

import re

import pytest

from main import app

#: Path parameters that tie a route to one team's work. Those routes are the
#: guest sweep's (tests/test_guest_role.py) and the read sweep's
#: (tests/test_external_accounts.py): a guest writes none of them, and an
#: account from outside reads only its epics through them.
TEAM_SCOPED = {
    "team_id",
    "ticket_id",
    "project_id",
    "sprint_id",
    "comment_id",
    "attachment_id",
    "link_id",
    "label_id",
    "status_id",
    "view_id",
    "rule_id",
    "repository_id",
    "webhook_id",
    "invite_id",
    "template_id",
    "field_id",
    "worklog_id",
    "number",
    "emoji",
}

#: What an account from outside may reach beyond its teams, and why. Anything
#: not here, not about one team, and not an admin's is refused with
#: `external_account`.
EXTERNAL_MAY = {
    ("GET", "/auth/config"): "how to sign in, before anybody has",
    ("POST", "/auth/register"): "creating the account an invitation is for",
    ("POST", "/auth/login"): "signing in",
    ("POST", "/auth/forgot-password"): "their own password",
    ("POST", "/auth/reset-password"): "their own password",
    ("GET", "/auth/me"): "their own account",
    ("PATCH", "/auth/me"): "their own account",
    ("POST", "/auth/me/password"): "their own password",
    ("GET", "/auth/me/tokens"): "their own API tokens",
    ("POST", "/auth/me/tokens"): "their own API tokens",
    ("DELETE", "/auth/me/tokens/{token_id}"): "their own API tokens",
    ("POST", "/auth/me/sign-out-everywhere"): "their own sessions",
    ("GET", "/auth/me/invites"): "invitations addressed to them",
    ("POST", "/auth/oauth/exchange"): "signing in with Google or GitHub",
    ("POST", "/auth/oauth/{provider}/link-ticket"): "their own sign-in methods",
    ("POST", "/auth/oauth/link"): "their own sign-in methods",
    ("GET", "/auth/me/identities"): "their own sign-in methods",
    ("DELETE", "/auth/me/identities/{provider}"): "their own sign-in methods",
    ("GET", "/invites/{token}"): "an invitation addressed to them",
    ("POST", "/invites/{token}/accept"): "an invitation addressed to them",
    ("POST", "/invites/{token}/decline"): "an invitation addressed to them",
    ("GET", "/teams"): "the teams they are a guest of",
    ("GET", "/search"): "search, confined to their epics (#243)",
    ("GET", "/notifications"): "their own notifications",
    ("GET", "/notifications/unread-count"): "their own notifications",
    ("GET", "/notifications/settings"): "their own notifications",
    ("PATCH", "/notifications/settings"): "their own notifications",
    ("POST", "/notifications/read-all"): "their own notifications",
    ("PATCH", "/notifications/{notification_id}"): "their own notifications",
    ("POST", "/webhooks/github/{hook_token}"): "called by a code host, not a person",
    ("POST", "/webhooks/gitlab/{hook_token}"): "called by a code host, not a person",
    ("GET", "/currencies"): "a fixed list of ISO codes",
    ("GET", "/health"): "nobody's business but the load balancer's",
}


def admin_only(method: str, path: str) -> bool:
    """Routes an admin of some kind holds, which an account from outside never
    is (#243): refused by their own guard, with its own code. Departments are
    read by everybody inside and changed by a site admin."""
    return path.startswith(("/admin/", "/finance/")) or (
        path.startswith("/departments") and method != "GET"
    )


def _routes() -> list[tuple[str, str]]:
    routes = []
    for path, operations in app.openapi()["paths"].items():
        if set(re.findall(r"{(\w+)}", path)) & TEAM_SCOPED:
            continue
        for method in operations:
            if method in ("get", "post", "put", "patch", "delete"):
                routes.append((method.upper(), path))
    return sorted(routes)


ROUTES = _routes()


@pytest.fixture
def outsider(client, team):
    """Carlos, invited to Engineering from outside, given no epics."""
    team_id = team["team"]["id"]
    invite = client.post(
        f"/teams/{team_id}/invites",
        json={"email": "carlos@acme-retail.com", "role": "guest", "external": True},
        headers=team["headers"],
    )
    assert invite.status_code == 200, invite.text
    body = client.post(
        "/auth/register",
        json={
            "email": "carlos@acme-retail.com",
            "password": "password123",
            "full_name": "Carlos Rivera",
            "invite_token": invite.json()["token"],
        },
    ).json()
    return {
        "user": body["user"],
        "headers": {"Authorization": f"Bearer {body['access_token']}"},
    }


def refused(response):
    assert response.status_code == 403, response.text
    assert response.json()["code"] == "external_account"


def test_they_cannot_create_a_team(client, outsider):
    refused(
        client.post(
            "/teams", json={"name": "Acme", "key": "ACME"}, headers=outsider["headers"]
        )
    )


def test_they_cannot_claim_an_expense(client, outsider):
    refused(
        client.post(
            "/expenses",
            json={
                "amount_minor": 1200,
                "currency": "EUR",
                "spent_on": "2026-09-01",
                "description": "Taxi",
                "category": "travel",
            },
            headers=outsider["headers"],
        )
    )
    refused(client.get("/expenses", headers=outsider["headers"]))


def test_they_see_no_directory_departments_or_workload(client, team, outsider):
    owner = team["user"]["username"]
    for path in (
        "/users",
        f"/users/{owner}",
        f"/users/{owner}/workload",
        "/departments",
        "/teams/directory",
    ):
        refused(client.get(path, headers=outsider["headers"]))


def test_somebody_inside_still_reaches_all_of_it(client, team):
    owner = team["user"]["username"]
    for path in ("/users", f"/users/{owner}", "/departments", "/teams/directory"):
        response = client.get(path, headers=team["headers"])
        assert response.status_code == 200, (path, response.text)


def test_they_see_people_by_name_and_never_by_address(client, team, outsider):
    team_id = team["team"]["id"]
    members = client.get(f"/teams/{team_id}/members", headers=outsider["headers"])
    assert members.status_code == 200, members.text
    by_name = {m["user"]["full_name"]: m["user"] for m in members.json()}
    assert by_name["Demo User"]["email"] == ""
    assert by_name["Demo User"]["username"] == team["user"]["username"]
    # Their own address is theirs.
    assert by_name["Carlos Rivera"]["email"] == "carlos@acme-retail.com"
    me = client.get("/auth/me", headers=outsider["headers"]).json()
    assert me["email"] == "carlos@acme-retail.com"

    # Inside, nothing changes, even straight after.
    inside = client.get(f"/teams/{team_id}/members", headers=team["headers"]).json()
    assert {m["user"]["email"] for m in inside} == {
        "demo@softtrack.dev",
        "carlos@acme-retail.com",
    }


def test_nor_on_the_tickets_they_can_see(client, team, outsider):
    """The address goes wherever a person does: here, a ticket's creator and
    a comment's author, on a ticket in their epic."""
    team_id = team["team"]["id"]
    h = team["headers"]
    portal = client.post(
        f"/teams/{team_id}/projects", json={"name": "Customer portal"}, headers=h
    ).json()
    ticket = client.post(
        f"/teams/{team_id}/tickets",
        json={"title": "Portal sign-in", "project_id": portal["id"]},
        headers=h,
    ).json()
    client.post(f"/tickets/{ticket['id']}/comments", json={"body": "Hi"}, headers=h)
    response = client.patch(
        f"/teams/{team_id}/members/{outsider['user']['id']}",
        json={"epic_ids": [portal["id"]]},
        headers=h,
    )
    assert response.status_code == 200, response.text

    for path in (
        f"/tickets/{ticket['id']}",
        f"/tickets/{ticket['id']}/comments",
        f"/teams/{team_id}/tickets",
    ):
        response = client.get(path, headers=outsider["headers"])
        assert response.status_code == 200, (path, response.text)
        assert "demo@softtrack.dev" not in response.text, path


# --- the sweep ----------------------------------------------------------------


def test_every_listed_route_is_a_real_route():
    assert set(EXTERNAL_MAY) <= set(ROUTES)


@pytest.mark.parametrize(
    ("method", "path"), ROUTES, ids=[f"{m} {p}" for m, p in ROUTES]
)
def test_every_route_beside_their_teams_is_decided(
    client, team, outsider, method, path
):
    """Every route not about one team's work, as an account from outside:
    one they may reach, one an admin holds, or refused with
    `external_account`. A route added next year is in one of those or this
    fails, the way the guest sweep fails on a write that forgot its guard."""
    names = re.findall(r"{(\w+)}", path)
    url = path.format(
        **{
            name: team["user"]["username"] if name == "username" else 1
            for name in names
        }
    )

    response = client.request(method, url, headers=outsider["headers"])
    body = (
        response.json()
        if response.headers.get("content-type", "").startswith("application/json")
        else {}
    )
    code = body.get("code") if isinstance(body, dict) else None

    if (method, path) in EXTERNAL_MAY:
        assert code != "external_account", (method, path, response.text)
    elif admin_only(method, path):
        assert response.status_code == 403, (method, path, response.text)
    else:
        assert response.status_code == 403 and code == "external_account", (
            f"{method} {path} answered {response.status_code} {response.text[:200]} "
            "to an account from outside the organisation. Refuse it with "
            "`get_current_insider` -- or, if they are meant to reach it, add it "
            "to EXTERNAL_MAY with the reason."
        )


def test_the_sweep_is_not_vacuous():
    assert ("POST", "/teams") in ROUTES
    assert ("GET", "/users/{username}/workload") in ROUTES
    assert not any("{team_id}" in path for _, path in ROUTES)

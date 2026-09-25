"""The guest role (#104): everything a member can see, nothing a member can change.

The heart of this file is `test_a_guest_is_refused_by_every_mutating_route`,
which is not a list of endpoints somebody remembered to check. It reads the
API's own OpenAPI schema and sends every POST, PUT, PATCH and DELETE in it as
a guest, so an endpoint added next year without the guard fails here the day it
is written. The only way past it is `NOT_TEAM_WRITES` below, which says in
words why each route there is allowed.
"""

import io
import re
from datetime import date, timedelta

import pytest
from sqlmodel import select

from lib_softtrack.tables import TeamMember, TeamRole
from main import app

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\x0f"
    b"\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)

#: Mutating routes a guest is *meant* to reach, and why. Everything else that
#: writes must refuse them.
NOT_TEAM_WRITES = {
    # Nobody's team yet: signing in, your own account, and site administration.
    ("POST", "/auth/register"): "no team involved",
    ("POST", "/auth/login"): "no team involved",
    ("POST", "/auth/forgot-password"): "no team involved",
    ("POST", "/auth/reset-password"): "no team involved",
    ("PATCH", "/auth/me"): "your own account",
    ("POST", "/auth/me/password"): "your own account",
    ("POST", "/auth/me/tokens"): "your own account",
    ("DELETE", "/auth/me/tokens/{token_id}"): "your own account",
    ("POST", "/auth/me/sign-out-everywhere"): "your own account",
    ("POST", "/auth/oauth/exchange"): "your own account",
    ("POST", "/auth/oauth/{provider}/link-ticket"): "your own account",
    ("POST", "/auth/oauth/link"): "your own account",
    ("DELETE", "/auth/me/identities/{provider}"): "your own account",
    ("PATCH", "/admin/users/{user_id}"): "site admins, not team roles",
    ("POST", "/admin/users/{user_id}/reset-password"): "site admins, not team roles",
    ("POST", "/teams"): "a new team, which its creator admins",
    # The invite link is the authority, and it names the role.
    ("POST", "/invites/{token}/accept"): "the invitation decides the role",
    ("POST", "/invites/{token}/decline"): "the invitation decides the role",
    # Your own relationship to the team -- the point of being a guest is to
    # follow along, and nobody else sees any of these.
    ("PUT", "/issues/{issue_id}/watch"): "following an issue is how a guest keeps up",
    ("PUT", "/teams/{team_id}/default-view/me"): "only changes what you see",
    (
        "DELETE",
        "/teams/{team_id}/members/{user_id}",
    ): "leaving; removing others is admin-only",
    ("PATCH", "/notifications/settings"): "your own inbox",
    ("POST", "/notifications/read-all"): "your own inbox",
    ("PATCH", "/notifications/{notification_id}"): "your own inbox",
    # Signed by a provider, not sent by a user.
    ("POST", "/webhooks/github/{hook_token}"): "authenticated by signature",
    ("POST", "/webhooks/gitlab/{hook_token}"): "authenticated by signature",
}


def _mutating_routes() -> list[tuple[str, str]]:
    schema = app.openapi()
    return sorted(
        (method.upper(), path)
        for path, operations in schema["paths"].items()
        for method in operations
        if method in {"post", "put", "patch", "delete"}
    )


TEAM_WRITES = [route for route in _mutating_routes() if route not in NOT_TEAM_WRITES]


def join(client, team, person, role):
    response = client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": person["user"]["email"], "role": role},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text


def make_issue(client, actor, team_id, title="Work"):
    response = client.post(
        f"/teams/{team_id}/issues", json={"title": title}, headers=actor["headers"]
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def guest(client, team, auth):
    """Someone who can look at the team's work and not touch it."""
    person = auth(email="client@example.com", full_name="Carol Client")
    join(client, team, person, "guest")
    return person


@pytest.fixture
def world(client, team, guest):
    """One of every row a mutating team route can name in its path.

    Keyed by the path parameter it fills. A route that names a parameter not
    in here fails the sweep loudly rather than being skipped, which is the
    point: this dictionary is where a new kind of row has to be introduced.
    """
    team_id = team["team"]["id"]
    h = team["headers"]

    def post(path, **kwargs):
        response = client.post(path, headers=h, **kwargs)
        assert response.status_code in (200, 201), (path, response.text)
        return response.json()

    issue = make_issue(client, team, team_id)
    other = make_issue(client, team, team_id, "Other")
    link = post(
        f"/issues/{issue['id']}/links",
        json={"target_id": other["id"], "type": "relates_to"},
    )
    attachment = post(
        f"/issues/{issue['id']}/attachments",
        files={"file": ("shot.png", io.BytesIO(PNG), "image/png")},
    )
    cycle = post(
        f"/teams/{team_id}/cycles",
        json={
            "name": "Sprint",
            "starts_at": date.today().isoformat(),
            "ends_at": (date.today() + timedelta(days=14)).isoformat(),
        },
    )
    project = post(f"/teams/{team_id}/projects", json={"name": "Launch"})
    view = post(
        f"/teams/{team_id}/views",
        json={"name": "Mine", "is_shared": True, "filters": {}},
    )
    rule = post(
        f"/teams/{team_id}/automation-rules",
        json={
            "name": "Rule",
            "trigger": "issue_created",
            "conditions": {},
            "actions": {"set_priority": "high"},
        },
    )
    repository = post(
        f"/teams/{team_id}/repositories",
        json={"provider": "github", "full_name": "acme/api"},
    )
    webhook = post(
        f"/teams/{team_id}/outbound-webhooks",
        json={"url": "https://93.184.216.34/hook", "events": ["issue.created"]},
    )
    invite = post(
        f"/teams/{team_id}/invites",
        json={"email": "later@example.com", "role": "member"},
    )
    comment = post(f"/issues/{issue['id']}/comments", json={"body": "Looks right"})
    worklog = post(f"/issues/{issue['id']}/worklogs", json={"minutes": 30})
    template = post(
        f"/teams/{team_id}/issue-templates",
        json={"name": "Bug report", "body": "## Steps"},
    )
    return {
        "team_id": team_id,
        "issue_id": issue["id"],
        "link_id": link["id"],
        "attachment_id": attachment["id"],
        "cycle_id": cycle["id"],
        "project_id": project["id"],
        "view_id": view["id"],
        "status_id": team["status_ids"]["Todo"],
        "rule_id": rule["id"],
        "repository_id": repository["id"],
        "webhook_id": webhook["id"],
        "invite_id": invite["id"],
        "comment_id": comment["id"],
        "emoji": "thumbs_up",
        "template_id": template["id"],
        "worklog_id": worklog["id"],
        # Somebody else on the team: changing *their* role is the write.
        "user_id": team["user"]["id"],
    }


# --- the sweep ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"), TEAM_WRITES, ids=[f"{m} {p}" for m, p in TEAM_WRITES]
)
def test_a_guest_is_refused_by_every_mutating_route(client, world, guest, method, path):
    names = re.findall(r"{(\w+)}", path)
    unknown = [name for name in names if name not in world]
    assert not unknown, (
        f"{method} {path} names {unknown}, which the guest sweep cannot fill. "
        "Add a row of that kind to the `world` fixture -- or, if a guest is "
        "meant to reach this route, add it to NOT_TEAM_WRITES with the reason."
    )
    url = path.format(**{name: world[name] for name in names})

    # No body at all. The guard runs before the body is parsed, so a guest is
    # refused for being a guest, not for sending nothing -- a 422 here would
    # mean the route checks its payload before it checks who is asking.
    response = client.request(method, url, headers=guest["headers"])

    assert response.status_code == 403, (method, path, response.text)
    assert response.json()["code"] == "team_read_only"


def test_the_sweep_is_not_vacuous():
    """The schema really is where the routes come from."""
    assert ("POST", "/teams/{team_id}/issues") in TEAM_WRITES
    assert ("PATCH", "/issues/{issue_id}") in TEAM_WRITES
    assert len(TEAM_WRITES) > 40


def test_every_exemption_is_a_real_route():
    """A renamed route should not leave a stale exemption quietly doing nothing."""
    routes = set(_mutating_routes())
    assert set(NOT_TEAM_WRITES) <= routes, set(NOT_TEAM_WRITES) - routes


# --- what a guest can do -----------------------------------------------------


def test_a_guest_sees_what_a_member_sees(client, team, guest, world):
    team_id = team["team"]["id"]
    issue_id = world["issue_id"]
    for path in (
        f"/teams/{team_id}",
        f"/teams/{team_id}/issues",
        f"/teams/{team_id}/members",
        f"/teams/{team_id}/cycles",
        f"/teams/{team_id}/statuses",
        f"/teams/{team_id}/velocity",
        f"/issues/{issue_id}",
        f"/issues/{issue_id}/comments",
        f"/issues/{issue_id}/attachments",
        f"/issues/{issue_id}/links",
        f"/cycles/{world['cycle_id']}/burndown",
        f"/attachments/{world['attachment_id']}/content",
    ):
        response = client.get(path, headers=guest["headers"])
        assert response.status_code == 200, (path, response.text)

    found = client.get("/search", params={"q": "Work"}, headers=guest["headers"])
    assert found.status_code == 200
    assert found.json()["items"], found.json()


def test_a_guest_can_watch_an_issue_and_is_notified(client, team, guest):
    issue = make_issue(client, team, team["team"]["id"])
    response = client.put(
        f"/issues/{issue['id']}/watch",
        json={"watching": True},
        headers=guest["headers"],
    )
    assert response.status_code == 200, response.text

    client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "Shipped to staging"},
        headers=team["headers"],
    )

    inbox = client.get("/notifications", headers=guest["headers"]).json()
    assert [n["kind"] for n in inbox["items"]] == ["commented"]


def test_a_guest_can_choose_their_own_default_view(client, team, guest, world):
    response = client.put(
        f"/teams/{team['team']['id']}/default-view/me",
        json={"view_id": world["view_id"]},
        headers=guest["headers"],
    )
    assert response.status_code == 200, response.text


def test_a_guest_can_leave(client, team, guest):
    response = client.delete(
        f"/teams/{team['team']['id']}/members/{guest['user']['id']}",
        headers=guest["headers"],
    )
    assert response.status_code == 204


def test_a_guest_cannot_remove_anyone_else(client, team, guest):
    response = client.delete(
        f"/teams/{team['team']['id']}/members/{team['user']['id']}",
        headers=guest["headers"],
    )
    assert response.status_code == 403
    assert response.json()["code"] == "not_team_admin"


# --- becoming one ------------------------------------------------------------


def test_an_invitation_can_make_someone_a_guest(client, team, auth):
    response = client.post(
        f"/teams/{team['team']['id']}/invites",
        json={"email": "stakeholder@example.com", "role": "guest"},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    invite = response.json()
    assert invite["role"] == "guest"

    stakeholder = auth(email="stakeholder@example.com", full_name="Sam Stakeholder")
    accepted = client.post(
        f"/invites/{invite['token']}/accept", headers=stakeholder["headers"]
    )
    assert accepted.status_code == 200, accepted.text

    roster = client.get(
        f"/teams/{team['team']['id']}/members", headers=team["headers"]
    ).json()
    assert {m["user"]["email"]: m["role"] for m in roster}[
        "stakeholder@example.com"
    ] == ("guest")
    refused = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": "Can I?"},
        headers=stakeholder["headers"],
    )
    assert refused.status_code == 403


def test_demoting_a_member_to_guest_takes_effect_at_once(client, team, auth, session):
    member = auth(email="member@softtrack.dev", full_name="Plain Member")
    join(client, team, member, "member")
    team_id = team["team"]["id"]
    assert (
        client.post(
            f"/teams/{team_id}/issues",
            json={"title": "Before"},
            headers=member["headers"],
        ).status_code
        == 200
    )

    response = client.patch(
        f"/teams/{team_id}/members/{member['user']['id']}",
        json={"role": "guest"},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    assert response.json()["role"] == "guest"

    after = client.post(
        f"/teams/{team_id}/issues", json={"title": "After"}, headers=member["headers"]
    )
    assert after.status_code == 403
    assert after.json()["code"] == "team_read_only"


def test_the_last_admin_cannot_become_a_guest(client, team):
    response = client.patch(
        f"/teams/{team['team']['id']}/members/{team['user']['id']}",
        json={"role": "guest"},
        headers=team["headers"],
    )
    assert response.status_code == 409
    assert response.json()["code"] == "last_team_admin"


def test_the_roster_lists_admins_then_members_then_guests(client, team, auth):
    # Joined in the opposite order, and "guest" sorts before "member" as a
    # string -- the two ways a naive ORDER BY would get this wrong.
    guest = auth(email="guest@softtrack.dev", full_name="Early Guest")
    join(client, team, guest, "guest")
    member = auth(email="member@softtrack.dev", full_name="Late Member")
    join(client, team, member, "member")

    roster = client.get(
        f"/teams/{team['team']['id']}/members", headers=team["headers"]
    ).json()
    assert [m["role"] for m in roster] == ["admin", "member", "guest"]


# --- the edges ---------------------------------------------------------------


def test_linking_into_a_team_you_only_guest_on_is_refused(client, team, auth):
    """The URL names your own team; the body names one you can only look at."""
    other_owner = auth(email="ops@softtrack.dev", full_name="Ops Owner")
    ops = client.post(
        "/teams",
        json={"name": "Operations", "key": "OPS"},
        headers=other_owner["headers"],
    ).json()
    client.post(
        f"/teams/{ops['id']}/members",
        json={"email": team["user"]["email"], "role": "guest"},
        headers=other_owner["headers"],
    )
    theirs = make_issue(client, other_owner, ops["id"], "Theirs")
    mine = make_issue(client, team, team["team"]["id"], "Mine")

    response = client.post(
        f"/issues/{mine['id']}/links",
        json={"target_id": theirs["id"], "type": "blocks"},
        headers=team["headers"],
    )
    assert response.status_code == 403
    assert response.json()["code"] == "team_read_only"


def test_the_guard_answers_a_missing_row_the_way_the_route_would(client, guest):
    response = client.patch(
        "/issues/999999", json={"title": "x"}, headers=guest["headers"]
    )
    assert response.status_code == 404
    assert response.json()["code"] == "issue_not_found"

    response = client.delete("/attachments/999999", headers=guest["headers"])
    assert response.status_code == 404
    assert response.json()["code"] == "attachment_not_found"


def test_a_stranger_is_still_not_a_member(client, team, auth):
    """The guard is a stricter membership check, not a replacement for one."""
    stranger = auth(email="stranger@softtrack.dev", full_name="Stranger")
    issue = make_issue(client, team, team["team"]["id"])
    response = client.patch(
        f"/issues/{issue['id']}", json={"title": "x"}, headers=stranger["headers"]
    )
    assert response.status_code == 403
    assert response.json()["code"] == "not_team_member"


def test_members_are_unaffected(client, team, auth, session):
    member = auth(email="member@softtrack.dev", full_name="Plain Member")
    join(client, team, member, "member")
    issue = make_issue(client, member, team["team"]["id"])
    response = client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "on it"},
        headers=member["headers"],
    )
    assert response.status_code == 200
    role = session.exec(
        select(TeamMember.role).where(TeamMember.user_id == member["user"]["id"])
    ).one()
    assert role == TeamRole.member

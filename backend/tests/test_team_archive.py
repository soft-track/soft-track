"""Archiving a team, and deleting one that was a mistake (#322).

An archived team is read-only for everybody on it, out of the switcher, the
pickers and search by default, and still there: its board, its tickets and
`ENG-42` keep opening. What would act on its own -- rules, webhooks both ways,
recurring tickets, reminders -- stops until it is unarchived, which puts it
back exactly as it was. Recurring tickets and due reminders checked
`archived_at` before #322 (#264, #262); tests/test_schedules.py and
tests/test_due_reminders.py hold theirs.

The heart of this file is `test_an_archived_team_refuses_every_mutating_route`,
the guest sweep (tests/test_guest_role.py) again: every POST, PUT, PATCH and
DELETE in the API's own schema, sent by the team's admin, on an archived team.
A route added next year that forgets the archive fails here the day it is
written.
"""

import hashlib
import hmac
import json
import re
import pytest
from sqlmodel import select

from lib_softtrack import outbound, rules
from lib_softtrack.tables import (
    AutomationRun,
    CodeLink,
    RetiredTeamKey,
    Team,
    Ticket,
    WebhookDelivery,
    utcnow,
)

# The guest sweep's fixtures: one row of every kind a mutating route names.
from test_guest_role import NOT_TEAM_WRITES, TEAM_WRITES, guest, world  # noqa: F401


def archive(client, actor, team_id, archived=True):
    response = client.patch(
        f"/teams/{team_id}", json={"archived": archived}, headers=actor["headers"]
    )
    assert response.status_code == 200, response.text
    return response.json()


def make_ticket(client, actor, team_id, title="Work", **fields):
    response = client.post(
        f"/teams/{team_id}/tickets",
        json={"title": title, **fields},
        headers=actor["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def add_member(client, team, person, role="member"):
    response = client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": person["user"]["email"], "role": role},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text


@pytest.fixture
def admin(auth):
    """The first account to register, and so the site admin."""
    return auth(email="admin@softtrack.dev", full_name="Site Admin")


@pytest.fixture
def owned(client, admin, auth):
    """A team whose admin is not a site admin, and a member of it."""
    owner = auth(email="owner@softtrack.dev", full_name="Olu Owner")
    response = client.post(
        "/teams", json={"name": "Engineering", "key": "ENG"}, headers=owner["headers"]
    )
    assert response.status_code == 200, response.text
    team = {**owner, "team": response.json()}
    member = auth(email="member@softtrack.dev", full_name="Mo Member")
    add_member(client, team, member)
    return {**team, "member": member}


# --- the sweep ---------------------------------------------------------------

#: Mutating routes the team's own admin still reaches on an archived team, and
#: why. Each has its own test below.
ARCHIVED_TEAM_TAKES = {
    ("PATCH", "/teams/{team_id}"): "unarchiving; the service refuses the rest",
    ("DELETE", "/teams/{team_id}"): "deleting it, when it is empty",
}

#: Routes the guest sweep leaves out that still change something on the team.
#: The rest of NOT_TEAM_WRITES is about no team, or only about you.
TEAM_ROUTES_GUESTS_REACH = [
    ("DELETE", "/teams/{team_id}/members/{user_id}"),
]

ARCHIVED_SWEEP = [
    route for route in TEAM_WRITES if route not in ARCHIVED_TEAM_TAKES
] + TEAM_ROUTES_GUESTS_REACH


@pytest.mark.parametrize(
    ("method", "path"), ARCHIVED_SWEEP, ids=[f"{m} {p}" for m, p in ARCHIVED_SWEEP]
)
def test_an_archived_team_refuses_every_mutating_route(
    client, team, world, method, path
):
    archive(client, team, world["team_id"])
    names = re.findall(r"{(\w+)}", path)
    url = path.format(**{name: world[name] for name in names})

    # The team's own admin, and no body: refused for the archive, before the
    # body is looked at.
    response = client.request(method, url, headers=team["headers"])

    assert response.status_code == 403, (method, path, response.text)
    assert response.json()["code"] == "team_read_only", (method, path)


def test_the_sweep_is_not_vacuous():
    assert ("POST", "/tickets/{ticket_id}/comments") in ARCHIVED_SWEEP
    assert ("PUT", "/comments/{comment_id}/reactions/{emoji}") in ARCHIVED_SWEEP
    assert ("POST", "/tickets/{ticket_id}/worklogs") in ARCHIVED_SWEEP
    assert len(ARCHIVED_SWEEP) > 40
    assert set(ARCHIVED_TEAM_TAKES) <= set(TEAM_WRITES)
    assert set(TEAM_ROUTES_GUESTS_REACH) <= set(NOT_TEAM_WRITES)


# --- archiving and unarchiving -----------------------------------------------


def test_archiving_twice_keeps_the_day_it_was_archived(client, owned):
    team_id = owned["team"]["id"]
    first = archive(client, owned, team_id)
    again = client.patch(
        f"/teams/{team_id}", json={"archived": True}, headers=owned["headers"]
    )
    assert again.status_code == 200, again.text
    assert again.json()["archived_at"] == first["archived_at"]


def test_the_admin_page_and_the_settings_mean_the_same(client, owned, admin):
    team_id = owned["team"]["id"]
    archive(client, owned, team_id)
    listed = client.get("/admin/teams", headers=admin["headers"]).json()["items"]
    [row] = [row for row in listed if row["id"] == team_id]
    assert row["archived_at"] is not None

    response = client.post(
        f"/admin/teams/{team_id}/unarchive", headers=admin["headers"]
    )
    assert response.status_code == 200, response.text
    read = client.get(f"/teams/{team_id}", headers=owned["headers"]).json()
    assert read["archived"] is False and read["archived_at"] is None


def test_unarchiving_puts_it_back_as_it_was(client, owned):
    team_id = owned["team"]["id"]
    ticket = make_ticket(client, owned, team_id, "Still here")
    before = client.get(f"/teams/{team_id}", headers=owned["headers"]).json()
    archive(client, owned, team_id)
    after = archive(client, owned, team_id, archived=False)

    assert {k: v for k, v in after.items() if k not in ("archived", "archived_at")} == {
        k: v for k, v in before.items() if k not in ("archived", "archived_at")
    }
    response = client.patch(
        f"/tickets/{ticket['id']}", json={"title": "Moving"}, headers=owned["headers"]
    )
    assert response.status_code == 200, response.text


def test_a_member_neither_archives_nor_unarchives(client, owned):
    team_id = owned["team"]["id"]
    member = owned["member"]
    response = client.patch(
        f"/teams/{team_id}", json={"archived": True}, headers=member["headers"]
    )
    assert response.status_code == 403
    assert response.json()["code"] == "not_team_admin"

    archive(client, owned, team_id)
    response = client.patch(
        f"/teams/{team_id}", json={"archived": False}, headers=member["headers"]
    )
    assert response.status_code == 403
    assert response.json()["code"] == "not_team_admin"


def test_a_guest_is_refused_at_the_door(client, owned, auth):
    """`team_keeper` refuses a guest before the body is read, as `team_writer`
    did on main -- the same code the guest sweep expects everywhere."""
    visitor = auth(email="visitor@example.com", full_name="Vi Guest")
    add_member(client, owned, visitor, "guest")
    for method in ("PATCH", "DELETE"):
        response = client.request(
            method, f"/teams/{owned['team']['id']}", headers=visitor["headers"]
        )
        assert response.status_code == 403, response.text
        assert response.json()["code"] == "team_read_only"


def test_an_archived_team_takes_no_settings_but_unarchiving(client, owned, admin):
    team_id = owned["team"]["id"]
    archive(client, owned, team_id)
    for actor in (owned, admin):
        for change in (
            {"name": "Renamed"},
            {"guests_may_comment": True},
            {"capacity_points": 3},
            {"archived": False, "name": "Renamed"},
        ):
            response = client.patch(
                f"/teams/{team_id}", json=change, headers=actor["headers"]
            )
            assert response.status_code == 403, (change, response.text)
            assert response.json()["code"] == "team_read_only"


def test_a_site_admin_archives_from_the_team_but_does_not_rename_it(
    client, owned, admin
):
    team_id = owned["team"]["id"]
    assert archive(client, admin, team_id)["archived"] is True
    assert archive(client, admin, team_id, archived=False)["archived"] is False
    response = client.patch(
        f"/teams/{team_id}", json={"name": "Mine now"}, headers=admin["headers"]
    )
    assert response.status_code == 403
    assert response.json()["code"] == "not_team_member"


def test_nobody_leaves_or_is_removed_from_an_archived_team(client, owned):
    team_id = owned["team"]["id"]
    member = owned["member"]
    ticket = make_ticket(
        client, owned, team_id, assignee_id=member["user"]["id"]
    )  # stays assigned
    archive(client, owned, team_id)
    for actor in (member, owned):
        response = client.delete(
            f"/teams/{team_id}/members/{member['user']['id']}",
            headers=actor["headers"],
        )
        assert response.status_code == 403, response.text
        assert response.json()["code"] == "team_read_only"
    read = client.get(f"/tickets/{ticket['id']}", headers=owned["headers"]).json()
    assert read["assignee"]["id"] == member["user"]["id"]


# --- still there -------------------------------------------------------------


def test_its_board_and_tickets_still_open(client, owned):
    team_id = owned["team"]["id"]
    ticket = make_ticket(client, owned, team_id, "Portal: invoice list page")
    archive(client, owned, team_id)

    assert client.get(f"/teams/{team_id}/tickets", headers=owned["headers"]).json()
    response = client.get(f"/tickets/{ticket['id']}", headers=owned["headers"])
    assert response.status_code == 200
    teams = client.get("/teams", headers=owned["headers"]).json()
    assert [(t["key"], t["archived"]) for t in teams] == [("ENG", True)]


def test_a_ticket_neither_moves_into_nor_out_of_an_archived_team(client, owned):
    other = client.post(
        "/teams", json={"name": "Operations", "key": "OPS"}, headers=owned["headers"]
    ).json()
    here = make_ticket(client, owned, owned["team"]["id"], "Here")
    there = make_ticket(client, owned, other["id"], "There")
    archive(client, owned, owned["team"]["id"])

    into = client.post(
        f"/tickets/{there['id']}/transfer",
        json={"team_id": owned["team"]["id"]},
        headers=owned["headers"],
    )
    assert into.status_code == 403, into.text
    assert into.json()["code"] == "team_read_only"
    out = client.post(
        f"/tickets/{here['id']}/transfer",
        json={"team_id": other["id"]},
        headers=owned["headers"],
    )
    assert out.status_code == 403, out.text
    assert out.json()["code"] == "team_read_only"


def test_a_ticket_elsewhere_does_not_link_to_an_archived_teams(client, owned):
    other = client.post(
        "/teams", json={"name": "Operations", "key": "OPS"}, headers=owned["headers"]
    ).json()
    here = make_ticket(client, owned, owned["team"]["id"], "Here")
    there = make_ticket(client, owned, other["id"], "There")
    archive(client, owned, owned["team"]["id"])

    response = client.post(
        f"/tickets/{there['id']}/links",
        json={"target_id": here["id"], "type": "relates_to"},
        headers=owned["headers"],
    )
    assert response.status_code == 403, response.text
    assert response.json()["code"] == "team_read_only"


def test_search_leaves_it_out_unless_asked_for_it(client, owned):
    team_id = owned["team"]["id"]
    make_ticket(client, owned, team_id, "Portal invoice list")
    archive(client, owned, team_id)

    everywhere = client.get(
        "/search", params={"q": "invoice"}, headers=owned["headers"]
    ).json()
    assert everywhere["total"] == 0
    narrowed = client.get(
        "/search", params={"q": "invoice", "team_id": team_id}, headers=owned["headers"]
    ).json()
    assert [hit["identifier"] for hit in narrowed["items"]] == ["ENG-1"]


def test_an_invitation_to_an_archived_team_is_not_live(client, owned, auth):
    team_id = owned["team"]["id"]
    response = client.post(
        f"/teams/{team_id}/invites",
        json={"email": "later@example.com", "role": "member"},
        headers=owned["headers"],
    )
    assert response.status_code == 200, response.text
    token = response.json()["token"]
    archive(client, owned, team_id)

    later = auth(email="later@example.com", full_name="Lee Later")
    assert client.get("/auth/me/invites", headers=later["headers"]).json() == []
    response = client.post(f"/invites/{token}/accept", headers=later["headers"])
    assert response.status_code == 404
    assert response.json()["code"] == "invite_invalid"


# --- what it stops -------------------------------------------------------------


def _archive_in_place(session, team_id):
    row = session.get(Team, team_id)
    row.archived_at = utcnow()
    session.add(row)
    session.commit()


def test_its_rules_do_not_run(client, owned, session):
    team_id = owned["team"]["id"]
    made = make_ticket(client, owned, team_id, "Arrived anyway")
    response = client.post(
        f"/teams/{team_id}/automation-rules",
        json={
            "name": "Urgent",
            "trigger": "ticket_created",
            "conditions": {},
            "actions": {"set_priority": "urgent"},
        },
        headers=owned["headers"],
    )
    assert response.status_code == 200, response.text
    _archive_in_place(session, team_id)

    # Nothing on an archived team changes, so nothing sets a rule off; were
    # something to, the rule still would not run.
    ticket = session.get(Ticket, made["id"])
    before = ticket.priority
    rules.on_ticket_created(session, ticket, None)
    session.commit()

    assert session.get(Ticket, made["id"]).priority == before
    assert session.exec(select(AutomationRun)).all() == []


def test_its_webhooks_send_nothing(client, owned, session):
    team_id = owned["team"]["id"]
    response = client.post(
        f"/teams/{team_id}/outbound-webhooks",
        json={"url": "https://93.184.216.34/hook", "events": ["ticket.created"]},
        headers=owned["headers"],
    )
    assert response.status_code == 200, response.text
    make_ticket(client, owned, team_id)  # queued before the archive
    _archive_in_place(session, team_id)

    assert (
        outbound.emit(
            session, team_id, outbound.WebhookEvent.ticket_created, dict, None
        )
        == 0
    )
    sent = []
    session.expire_all()
    outbound.deliver_due(session, sender=lambda *call: sent.append(call) or (200, "ok"))
    assert sent == []
    [delivery] = session.exec(select(WebhookDelivery)).all()
    assert delivery.status == "failed"
    assert "archived" in delivery.response_excerpt


def test_its_repositories_link_nothing(client, owned, session):
    team_id = owned["team"]["id"]
    repo = client.post(
        f"/teams/{team_id}/repositories",
        json={"provider": "github", "full_name": "acme/api"},
        headers=owned["headers"],
    ).json()
    make_ticket(client, owned, team_id)
    archive(client, owned, team_id)

    body = json.dumps(
        {
            "ref": "refs/heads/eng-1-fix",
            "repository": {"full_name": "acme/api", "html_url": "https://gh/a"},
            "pusher": {"name": "sam"},
            "commits": [
                {
                    "id": "abc123",
                    "message": "ENG-1 fix it",
                    "url": "https://gh/c/abc123",
                    "author": {"name": "Sam"},
                }
            ],
        }
    ).encode()
    digest = hmac.new(repo["secret"].encode(), body, hashlib.sha256).hexdigest()
    response = client.post(
        "/webhooks/github/" + repo["webhook_url"].rsplit("/", 1)[1],
        content=body,
        headers={
            "X-Hub-Signature-256": f"sha256={digest}",
            "X-GitHub-Event": "push",
            "Content-Type": "application/json",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["team_archived"] is True
    assert response.json()["links"] == 0
    assert session.exec(select(CodeLink)).all() == []


# --- the dialog's counts ---------------------------------------------------------


def test_the_preview_counts_what_stops_and_what_stays(client, owned, auth):
    team_id = owned["team"]["id"]
    h = owned["headers"]
    for name in ("One", "Two", "Three"):
        client.post(
            f"/teams/{team_id}/automation-rules",
            json={
                "name": name,
                "trigger": "ticket_created",
                "conditions": {},
                "actions": {"set_priority": "high"},
            },
            headers=h,
        )
    client.post(
        f"/teams/{team_id}/outbound-webhooks",
        json={"url": "https://93.184.216.34/hook", "events": ["ticket.created"]},
        headers=h,
    )
    for full_name in ("acme/api", "acme/web"):
        client.post(
            f"/teams/{team_id}/repositories",
            json={"provider": "github", "full_name": full_name},
            headers=h,
        )
    client.post(
        f"/teams/{team_id}/ticket-schedules",
        json={"title": "Dependency updates", "frequency": "weekly", "weekdays": [0]},
        headers=h,
    )
    statuses = {
        s["name"]: s["id"]
        for s in client.get(f"/teams/{team_id}/statuses", headers=h).json()
    }
    make_ticket(client, owned, team_id, "Open")
    make_ticket(client, owned, team_id, "Shipped", status_id=statuses["Done"])
    trashed = make_ticket(client, owned, team_id, "Binned")
    client.delete(f"/tickets/{trashed['id']}", headers=h)
    add_member(client, owned, auth(email="g@example.com", full_name="G"), "guest")

    response = client.get(f"/teams/{team_id}/archive-preview", headers=h)
    assert response.status_code == 200, response.text
    assert response.json() == {
        "members": 3,
        "automation_rules": 3,
        "webhooks": 1,
        "repository_links": 2,
        "recurring_tickets": 1,
        "open_tickets": 1,
        "tickets": 3,
    }


def test_the_preview_is_for_admins(client, owned, admin):
    url = f"/teams/{owned['team']['id']}/archive-preview"
    response = client.get(url, headers=owned["member"]["headers"])
    assert response.status_code == 403
    assert response.json()["code"] == "not_team_admin"
    assert client.get(url, headers=admin["headers"]).status_code == 200


# --- the key stays taken -------------------------------------------------------


def test_an_archived_teams_key_is_refused_with_its_own_code(client, owned):
    archive(client, owned, owned["team"]["id"])
    response = client.post(
        "/teams", json={"name": "Engineering", "key": "eng"}, headers=owned["headers"]
    )
    assert response.status_code == 400
    assert response.json()["code"] == "team_key_archived"
    assert response.json()["detail"] == (
        "ENG belongs to an archived team, and a key is never given back."
    )


def test_asking_for_a_team_with_an_archived_key_is_refused_too(client, owned, admin):
    archive(client, owned, owned["team"]["id"])
    response = client.post(
        "/teams/requests",
        json={"name": "Engineering", "key": "ENG", "reason": "Ours"},
        headers=owned["member"]["headers"],
    )
    assert response.status_code == 400
    assert response.json()["code"] == "team_key_archived"


def test_a_deleted_team_that_gave_out_identifiers_keeps_its_key(client, owned):
    """Its tickets moved away: `ENG-1` is still in their history and in
    commit messages, so the key is retired, not freed."""
    other = client.post(
        "/teams", json={"name": "Operations", "key": "OPS"}, headers=owned["headers"]
    ).json()
    ticket = make_ticket(client, owned, owned["team"]["id"])
    moved = client.post(
        f"/tickets/{ticket['id']}/transfer",
        json={"team_id": other["id"]},
        headers=owned["headers"],
    )
    assert moved.status_code == 200, moved.text
    response = client.delete(f"/teams/{owned['team']['id']}", headers=owned["headers"])
    assert response.status_code == 204, response.text

    response = client.post(
        "/teams", json={"name": "Again", "key": "ENG"}, headers=owned["headers"]
    )
    assert response.status_code == 400
    assert response.json()["code"] == "team_key_retired"


def test_a_team_deleted_before_its_first_ticket_gives_its_key_back(
    client, owned, session
):
    response = client.delete(f"/teams/{owned['team']['id']}", headers=owned["headers"])
    assert response.status_code == 204, response.text
    assert session.exec(select(RetiredTeamKey)).all() == []
    response = client.post(
        "/teams", json={"name": "Again", "key": "ENG"}, headers=owned["headers"]
    )
    assert response.status_code == 200, response.text


# --- deleting --------------------------------------------------------------------


@pytest.mark.parametrize("door", ["team", "admin"])
def test_both_doors_delete_an_archived_empty_team(client, owned, admin, door):
    team_id = owned["team"]["id"]
    archive(client, owned, team_id)
    if door == "team":
        response = client.delete(f"/teams/{team_id}", headers=owned["headers"])
    else:
        response = client.delete(f"/admin/teams/{team_id}", headers=admin["headers"])
    assert response.status_code == 204, response.text


@pytest.mark.parametrize("door", ["team", "admin"])
def test_neither_door_deletes_a_team_whose_tickets_are_in_the_trash(
    client, owned, admin, door
):
    team_id = owned["team"]["id"]
    ticket = make_ticket(client, owned, team_id)
    client.delete(f"/tickets/{ticket['id']}", headers=owned["headers"])
    actor = owned if door == "team" else admin
    path = f"/teams/{team_id}" if door == "team" else f"/admin/teams/{team_id}"
    response = client.delete(path, headers=actor["headers"])
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "team_not_empty"


def test_a_member_does_not_delete_the_team(client, owned):
    response = client.delete(
        f"/teams/{owned['team']['id']}", headers=owned["member"]["headers"]
    )
    assert response.status_code == 403
    assert response.json()["code"] == "not_team_admin"

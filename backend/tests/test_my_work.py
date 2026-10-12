"""My work (#258): the open tickets that are mine, across every team I am on.

Assigned to me, watching and created by me; grouped by team or as one list;
what is late or due soon pulled to the top; what waits on me beside it. And
confined as everything is: the trash, accounts from outside, teams I am not
on, archived teams."""

import pytest

from lib_softtrack.tables import TicketWatch
from tests.conftest import status_ids

TODAY = "2026-10-12"


def _ok(response):
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def org(client, auth):
    """Ira runs the instance. Mei is on Engineering (Amina's) and on Product &
    Design (Lena's); Amina is on neither of Lena's teams. Lena also runs
    Support, which Mei is not on."""
    people = {
        "ira": auth(email="it@northwind.dev", full_name="Ira Admin"),
        "mei": auth(email="mei@northwind.dev", full_name="Mei Tanaka"),
        "amina": auth(email="amina@northwind.dev", full_name="Amina Khan"),
        "lena": auth(email="lena@northwind.dev", full_name="Lena Fischer"),
        "daniel": auth(email="daniel@northwind.dev", full_name="Daniel Okafor"),
    }

    def team(owner, name, key, members):
        created = _ok(
            client.post(
                "/teams", json={"name": name, "key": key}, headers=owner["headers"]
            )
        )
        for member in members:
            _ok(
                client.post(
                    f"/teams/{created['id']}/members",
                    json={"email": member["user"]["email"]},
                    headers=owner["headers"],
                )
            )
        created["status"] = status_ids(client, owner, created["id"])
        created["owner"] = owner
        return created

    eng = team(people["amina"], "Engineering", "ENG", [people["mei"], people["daniel"]])
    prd = team(people["lena"], "Product & Design", "PRD", [people["mei"]])
    sup = team(people["lena"], "Support", "SUP", [people["mei"]])
    return {**people, "eng": eng, "prd": prd, "sup": sup}


def ticket(client, team, title, by=None, **fields):
    by = by or team["owner"]
    return _ok(
        client.post(
            f"/teams/{team['id']}/tickets",
            json={"title": title, **fields},
            headers=by["headers"],
        )
    )


def work(client, actor, **params):
    return _ok(
        client.get(
            "/me/work", params={"today": TODAY, **params}, headers=actor["headers"]
        )
    )


def titles(rows):
    return [row["title"] for row in rows]


@pytest.fixture
def plate(client, org):
    """Mei's work on Engineering and on Product & Design."""
    mei = org["mei"]["user"]["id"]
    eng, prd = org["eng"], org["prd"]
    s = eng["status"]
    epic = _ok(
        client.post(
            f"/teams/{eng['id']}/projects",
            json={"name": "Customer portal"},
            headers=org["amina"]["headers"],
        )
    )
    made = {
        "late": ticket(
            client,
            eng,
            "Invoice PDF renders blank on Safari",
            assignee_id=mei,
            type="bug",
            due_date="2026-09-29",
            project_id=epic["id"],
            estimate=2,
        ),
        "backlog": ticket(
            client, eng, "Empty state", assignee_id=mei, status_id=s["Backlog"]
        ),
        "todo_low": ticket(
            client,
            eng,
            "Low todo",
            assignee_id=mei,
            status_id=s["Todo"],
            priority="low",
        ),
        "todo_urgent": ticket(
            client,
            eng,
            "Urgent todo",
            assignee_id=mei,
            status_id=s["Todo"],
            priority="urgent",
        ),
        "todo_dated": ticket(
            client,
            eng,
            "Dated todo",
            assignee_id=mei,
            status_id=s["Todo"],
            priority="low",
            due_date="2026-10-30",
        ),
        "started": ticket(
            client,
            eng,
            "In flight",
            assignee_id=mei,
            status_id=s["In Progress"],
            estimate=3,
        ),
        "done": ticket(client, eng, "Shipped", assignee_id=mei, status_id=s["Done"]),
        "cancelled": ticket(
            client, eng, "Dropped", assignee_id=mei, status_id=s["Cancelled"]
        ),
        "theirs": ticket(
            client, eng, "Daniel's", assignee_id=org["daniel"]["user"]["id"]
        ),
        "soon": ticket(
            client,
            prd,
            "Review the statements wireframes",
            assignee_id=mei,
            due_date="2026-10-15",
            estimate=1,
        ),
        "prd": ticket(client, prd, "Copy for the empty invoice list", assignee_id=mei),
        "later": ticket(
            client, prd, "Onboarding tour", assignee_id=mei, due_date="2026-10-16"
        ),
    }
    return {**made, "epic": epic}


# --- Assigned to me ------------------------------------------------------------


def test_assigned_to_me_is_grouped_by_team_with_totals_from_the_database(
    client, org, plate
):
    body = work(client, org["mei"])

    assert body["tab"] == "assigned" and body["grouping"] == "team"
    groups = {group["team"]["key"]: group for group in body["teams"]}
    # By team name; finished work and somebody else's are not on the plate.
    assert [group["team"]["key"] for group in body["teams"]] == ["ENG", "PRD"]
    assert groups["ENG"]["open_count"] == 6
    assert groups["ENG"]["points"] == 5
    assert groups["PRD"]["open_count"] == 3
    assert body["counts"]["assigned"] == 9


def test_in_flight_first_then_by_due_date_then_priority(client, org, plate):
    eng = work(client, org["mei"], per_team=10)["teams"][0]

    assert titles(eng["tickets"]) == [
        "In flight",
        "Dated todo",
        "Urgent todo",
        "Low todo",
        "Empty state",
    ]


def test_due_soon_and_overdue_are_pulled_to_the_top_and_out_of_the_groups(
    client, org, plate
):
    body = work(client, org["mei"], per_team=10)

    # Late first, then what falls due in the next three days; the 16th is four
    # days away, and the 30th further.
    assert titles(body["due"]) == [
        "Invoice PDF renders blank on Safari",
        "Review the statements wireframes",
    ]
    late = body["due"][0]
    assert late["identifier"] == "ENG-1"
    assert late["type"] == "bug"
    assert late["due_date"] == "2026-09-29"
    assert late["project"]["name"] == "Customer portal"
    groups = {group["team"]["key"]: group for group in body["teams"]}
    listed = titles(groups["ENG"]["tickets"]) + titles(groups["PRD"]["tickets"])
    assert "Invoice PDF renders blank on Safari" not in listed
    assert "Review the statements wireframes" not in listed
    assert "Onboarding tour" in listed
    # The totals still count them; what the group lists does not.
    assert groups["ENG"]["open_count"] == 6 and groups["ENG"]["listed_count"] == 5
    assert groups["PRD"]["open_count"] == 3 and groups["PRD"]["listed_count"] == 2


def test_due_soon_is_the_viewers_today(client, org, plate):
    body = work(client, org["mei"], today="2026-09-01")
    assert body["due"] == []


def test_finished_work_is_never_overdue(client, org, plate):
    s = org["eng"]["status"]
    _ok(
        client.patch(
            f"/tickets/{plate['late']['id']}",
            json={"status_id": s["Done"]},
            headers=org["amina"]["headers"],
        )
    )
    assert titles(work(client, org["mei"])["due"]) == [
        "Review the statements wireframes"
    ]


def test_a_groups_next_page(client, org, plate):
    first = work(client, org["mei"], per_team=2)
    eng = first["teams"][0]
    assert titles(eng["tickets"]) == ["In flight", "Dated todo"]

    more = work(client, org["mei"], per_team=2, team_id=org["eng"]["id"], offset=2)
    assert [group["team"]["key"] for group in more["teams"]] == ["ENG"]
    assert titles(more["teams"][0]["tickets"]) == ["Urgent todo", "Low todo"]
    assert more["teams"][0]["offset"] == 2


def test_as_one_list(client, org, plate):
    body = work(client, org["mei"], grouping="none", limit=3)

    assert body["teams"] == []
    page = body["tickets"]
    # Everything but what was pulled to the top, in the same order, across
    # teams: the team's key says where each lives.
    assert page["total"] == 7
    assert [row["identifier"] for row in page["items"]] == ["ENG-6", "ENG-5", "ENG-4"]
    rest = work(client, org["mei"], grouping="none", limit=10, offset=3)["tickets"]
    # The rest of the accepted work, then the backlog: dated first, then the
    # newest.
    assert titles(rest["items"]) == [
        "Low todo",
        "Onboarding tour",
        "Copy for the empty invoice list",
        "Empty state",
    ]
    assert len(work(client, org["mei"], grouping="none")["due"]) == 2


# --- Watching and Created by me --------------------------------------------------


def test_watching_lists_what_i_watch_with_what_last_happened(client, org):
    mei, amina = org["mei"], org["amina"]
    eng = org["eng"]
    commented = ticket(client, eng, "Portal: sign-in with magic link")
    reassigned = ticket(client, eng, "Rate-limit the portal")
    quiet = ticket(client, eng, "Nothing since")
    unwatched = ticket(client, eng, "Stopped watching")
    for watched in (commented, reassigned, quiet, unwatched):
        _ok(
            client.put(
                f"/tickets/{watched['id']}/watch",
                json={"watching": True},
                headers=mei["headers"],
            )
        )
    _ok(
        client.put(
            f"/tickets/{unwatched['id']}/watch",
            json={"watching": False},
            headers=mei["headers"],
        )
    )
    _ok(
        client.post(
            f"/tickets/{commented['id']}/comments",
            json={"body": "Looks good"},
            headers=amina["headers"],
        )
    )
    _ok(
        client.patch(
            f"/tickets/{reassigned['id']}",
            json={"assignee_id": org["daniel"]["user"]["id"]},
            headers=amina["headers"],
        )
    )

    body = work(client, mei, tab="watching", grouping="none")

    rows = {row["title"]: row for row in body["tickets"]["items"]}
    assert "Stopped watching" not in rows
    assert set(rows) == {
        "Portal: sign-in with magic link",
        "Rate-limit the portal",
        "Nothing since",
    }
    assert body["counts"]["watching"] == 3
    said = rows["Portal: sign-in with magic link"]["last_activity"]
    assert said["kind"] == "commented"
    assert said["actor"]["full_name"] == "Amina Khan"
    moved = rows["Rate-limit the portal"]["last_activity"]
    assert moved["kind"] == "changed"
    assert moved["field"] == "assignee"
    assert moved["new_label"] == "Daniel Okafor"
    assert rows["Nothing since"]["last_activity"]["kind"] == "created"
    # Only Assigned to me pulls what is due to the top.
    assert body["due"] == []


def test_created_by_me(client, org, plate):
    mine = ticket(client, org["eng"], "Mei's own idea", by=org["mei"])
    ticket(client, org["eng"], "Mei's second idea", by=org["mei"])
    done = ticket(client, org["eng"], "Done already", by=org["mei"])
    _ok(
        client.patch(
            f"/tickets/{done['id']}",
            json={"status_id": org["eng"]["status"]["Done"]},
            headers=org["mei"]["headers"],
        )
    )

    body = work(client, org["mei"], tab="created")

    listed = [row for group in body["teams"] for row in group["tickets"]]
    assert sorted(titles(listed)) == ["Mei's own idea", "Mei's second idea"]
    assert body["counts"]["created"] == 2
    assert mine["id"] in [row["id"] for row in listed]


# --- What it is confined to --------------------------------------------------------


def test_a_team_i_am_no_longer_on_is_neither_listed_nor_counted(client, org, plate):
    removed = client.delete(
        f"/teams/{org['prd']['id']}/members/{org['mei']['user']['id']}",
        headers=org["lena"]["headers"],
    )
    assert removed.status_code < 300, removed.text

    body = work(client, org["mei"])

    assert [group["team"]["key"] for group in body["teams"]] == ["ENG"]
    assert body["counts"]["assigned"] == 6
    assert titles(body["due"]) == ["Invoice PDF renders blank on Safari"]


def test_somebody_else_sees_their_own(client, org, plate):
    body = work(client, org["daniel"])
    assert body["counts"]["assigned"] == 1
    assert titles(body["teams"][0]["tickets"]) == ["Daniel's"]


def test_a_site_admin_gets_no_wider_view(client, org, plate):
    body = work(client, org["ira"])
    assert body["counts"] == {"assigned": 0, "watching": 0, "created": 0}
    assert body["teams"] == []


def test_what_is_in_the_trash_is_not_here(client, org, plate):
    assert (
        client.delete(
            f"/tickets/{plate['late']['id']}", headers=org["amina"]["headers"]
        ).status_code
        == 204
    )

    body = work(client, org["mei"])

    assert "Invoice PDF renders blank on Safari" not in titles(body["due"])
    assert body["counts"]["assigned"] == 8


def test_an_archived_team_is_left_out(client, org, plate):
    _ok(
        client.post(
            f"/admin/teams/{org['prd']['id']}/archive", headers=org["ira"]["headers"]
        )
    )

    body = work(client, org["mei"])

    assert [group["team"]["key"] for group in body["teams"]] == ["ENG"]
    assert body["counts"]["assigned"] == 6
    assert titles(body["due"]) == ["Invoice PDF renders blank on Safari"]


def test_an_account_from_outside_sees_only_its_epics(client, session, org, plate):
    eng, amina = org["eng"], org["amina"]
    invite = _ok(
        client.post(
            f"/teams/{eng['id']}/invites",
            json={
                "email": "carlos@acme-retail.com",
                "role": "guest",
                "external": True,
                "epic_ids": [plate["epic"]["id"]],
            },
            headers=amina["headers"],
        )
    )
    carlos = _ok(
        client.post(
            "/auth/register",
            json={
                "email": "carlos@acme-retail.com",
                "password": "password123",
                "full_name": "Carlos Rivera",
                "invite_token": invite["token"],
            },
        )
    )
    headers = {"Authorization": f"Bearer {carlos['access_token']}"}
    # A guest is never assigned anything, so what he watches: one ticket in
    # his epic, and -- from before he was confined -- one outside it.
    _ok(
        client.put(
            f"/tickets/{plate['late']['id']}/watch",
            json={"watching": True},
            headers=headers,
        )
    )
    session.add(
        TicketWatch(
            ticket_id=plate["backlog"]["id"],
            user_id=carlos["user"]["id"],
            watching=True,
        )
    )
    session.commit()

    body = work(client, {"headers": headers}, tab="watching", grouping="none")

    assert body["counts"]["watching"] == 1
    assert titles(body["tickets"]["items"]) == ["Invoice PDF renders blank on Safari"]


# --- Waiting on me -----------------------------------------------------------------


def test_waiting_on_me_holds_invitations_and_requests_to_join_my_teams(
    client, org, auth
):
    lena, mei = org["lena"], org["mei"]
    yuki = auth(email="yuki@northwind.dev", full_name="Yuki Sato")
    ops = _ok(
        client.post(
            "/teams", json={"name": "Operations", "key": "OPS"}, headers=lena["headers"]
        )
    )
    _ok(
        client.post(
            f"/teams/{ops['id']}/invites",
            json={"email": "mei@northwind.dev", "role": "member"},
            headers=lena["headers"],
        )
    )
    _ok(
        client.post(
            f"/teams/{org['eng']['id']}/join-requests",
            json={},
            headers=yuki["headers"],
        )
    )

    waiting_mei = work(client, mei)["waiting"]
    assert [invite["team_key"] for invite in waiting_mei["invites"]] == ["OPS"]
    # Mei is on Engineering, but does not run it: Yuki's request is Amina's.
    assert waiting_mei["join_requests"] == []
    asked = work(client, org["amina"])["waiting"]["join_requests"]
    assert [(r["team"]["key"], r["requester"]["full_name"]) for r in asked] == [
        ("ENG", "Yuki Sato")
    ]

    # An archived team has nothing to join.
    _ok(
        client.post(
            f"/admin/teams/{org['eng']['id']}/archive", headers=org["ira"]["headers"]
        )
    )
    assert work(client, org["amina"])["waiting"]["join_requests"] == []


def test_it_works_with_no_team(client, auth, org):
    nobody = auth(email="new@northwind.dev", full_name="New Hire")
    body = work(client, nobody)
    assert body["counts"] == {"assigned": 0, "watching": 0, "created": 0}
    assert body["teams"] == [] and body["due"] == []
    assert body["waiting"] == {"invites": [], "join_requests": []}

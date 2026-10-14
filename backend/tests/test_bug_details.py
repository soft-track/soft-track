"""Bug details (#273): severity, environment and the release a bug was found in.

On tickets of type bug only. Severity is separate from priority; an
environment is one of the team's; found in points at a release, beside the
fix version that says where it is fixed. The board filters, groups and sorts
by them, a report counts open bugs by severity week by week, and changing a
ticket's type away from bug keeps the values and hides them.
"""

import csv
import io
from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import select

from lib_softtrack.tables import Ticket, TicketEvent, TicketEventField
from lib_softtrack.trash import INCLUDE_TRASHED


def _ok(response):
    assert response.status_code == 200, response.text
    return response.json()


def _code(response, status, code):
    assert response.status_code == status, response.text
    assert response.json()["code"] == code, response.text


@pytest.fixture
def board(client, team):
    team_id = team["team"]["id"]
    h = team["headers"]

    def ticket(title, **fields):
        return _ok(
            client.post(
                f"/teams/{team_id}/tickets", json={"title": title, **fields}, headers=h
            )
        )

    def bug(title, **fields):
        return ticket(title, type="bug", **fields)

    def release(name):
        return _ok(
            client.post(f"/teams/{team_id}/releases", json={"name": name}, headers=h)
        )

    def patch(ticket_, **fields):
        return client.patch(f"/tickets/{ticket_['id']}", json=fields, headers=h)

    def titles(params):
        page = _ok(client.get(f"/teams/{team_id}/tickets", params=params, headers=h))
        return [item["title"] for item in page["items"]]

    return {
        **team,
        "team_id": team_id,
        "h": h,
        "ticket": ticket,
        "bug": bug,
        "release": release,
        "patch": patch,
        "titles": titles,
        "done": team["status_ids"]["Done"],
    }


def test_a_bug_has_a_severity_an_environment_and_the_release_it_was_found_in(
    client, board
):
    found = board["release"]("1.3.2")
    fixed = board["release"]("1.4.0")
    bug = board["bug"](
        "Invoice PDF renders blank on Safari",
        severity="major",
        # Matched whatever the case, and stored as the team spells it.
        environment="production",
        found_in_id=found["id"],
        fix_version_id=fixed["id"],
        priority="no_priority",
    )
    assert (bug["severity"], bug["environment"], bug["found_in_id"]) == (
        "major",
        "Production",
        found["id"],
    )
    assert bug["fix_version_id"] == fixed["id"]
    # Severity is not priority: a major bug can wait.
    assert bug["priority"] == "no_priority"


def test_a_team_starts_with_three_environments(client, board):
    read = _ok(client.get(f"/teams/{board['team_id']}", headers=board["h"]))
    assert read["environments"] == ["Production", "Staging", "Development"]


def test_only_a_bug_is_given_them(client, board):
    refused = client.post(
        f"/teams/{board['team_id']}/tickets",
        json={"title": "A task", "severity": "minor"},
        headers=board["h"],
    )
    _code(refused, 400, "bug_details_need_a_bug")

    task = board["ticket"]("Bump the PDF library")
    _code(board["patch"](task, environment="Staging"), 400, "bug_details_need_a_bug")
    # The same change that makes it a bug may give it them.
    made = _ok(board["patch"](task, type="bug", severity="minor"))
    assert (made["type"], made["severity"]) == ("bug", "minor")


def test_changing_the_type_away_keeps_the_values_and_back_shows_them(client, board):
    bug = board["bug"]("Totals round differently", severity="critical")
    task = _ok(board["patch"](bug, type="task"))
    # Kept on the ticket, for when it is a bug again...
    assert task["severity"] == "critical"
    # ...and asked about only while it is one.
    assert board["titles"]({"severity": "critical"}) == []

    back = _ok(board["patch"](task, type="bug"))
    assert back["severity"] == "critical"
    assert board["titles"]({"severity": "critical"}) == [bug["title"]]

    cleared = _ok(board["patch"](_ok(board["patch"](back, type="task")), severity=None))
    assert cleared["severity"] is None


def test_an_environment_is_one_of_the_teams(client, board, auth):
    _code(
        client.post(
            f"/teams/{board['team_id']}/tickets",
            json={"title": "Bug", "type": "bug", "environment": "Moon base"},
            headers=board["h"],
        ),
        400,
        "environment_not_on_team",
    )

    teams = f"/teams/{board['team_id']}"
    updated = _ok(
        client.patch(
            teams,
            json={"environments": ["Production", " Staging ", "Demo"]},
            headers=board["h"],
        )
    )
    assert updated["environments"] == ["Production", "Staging", "Demo"]
    demo = board["bug"]("On the demo box", environment="demo")
    assert demo["environment"] == "Demo"

    # A name taken off the list stays on the bugs that have it, and may be
    # sent back unchanged.
    _ok(client.patch(teams, json={"environments": ["Production"]}, headers=board["h"]))
    kept = _ok(board["patch"](demo, environment="Demo", severity="minor"))
    assert kept["environment"] == "Demo"
    other = board["bug"]("Elsewhere")
    _code(board["patch"](other, environment="Demo"), 400, "environment_not_on_team")

    for bad in (["Production", "production"], ["  "], ["x" * 41]):
        _code(
            client.patch(teams, json={"environments": bad}, headers=board["h"]),
            422,
            "environments_invalid",
        )

    member = auth(email="member@example.com", full_name="Mei Tanaka")
    invite = _ok(
        client.post(
            f"/teams/{board['team_id']}/invites",
            json={"email": "member@example.com", "role": "member"},
            headers=board["h"],
        )
    )
    _ok(client.post(f"/invites/{invite['token']}/accept", headers=member["headers"]))
    _code(
        client.patch(teams, json={"environments": []}, headers=member["headers"]),
        403,
        "not_team_admin",
    )


def test_a_bugs_history_says_how_bad_where_and_since_when(client, board):
    found = board["release"]("1.3.2")
    bug = board["bug"]("Sign-in link works twice")
    _ok(
        board["patch"](
            bug, severity="major", environment="Staging", found_in_id=found["id"]
        )
    )
    events = _ok(client.get(f"/tickets/{bug['id']}/events", headers=board["h"]))
    changed = {
        event["field"]: (event["new_value"], event["new_label"]) for event in events
    }
    assert changed["severity"] == ("major", None)
    assert changed["environment"] == ("Staging", None)
    assert changed["found_in"] == (str(found["id"]), "1.3.2")


def test_the_board_filters_on_severity_environment_and_found_in(client, board):
    found = board["release"]("1.3")
    board["bug"](
        "Critical in production",
        severity="critical",
        environment="Production",
        found_in_id=found["id"],
    )
    board["bug"]("Major in production", severity="major", environment="Production")
    board["bug"]("Major on staging", severity="major", environment="Staging")
    board["bug"]("Trivial, nowhere in particular", severity="trivial")
    board["bug"]("Unrated")
    board["ticket"]("A task")

    def titles(params):
        return sorted(board["titles"](params))

    assert titles({"severity": ["critical", "major"], "environment": "Production"}) == [
        "Critical in production",
        "Major in production",
    ]
    # Excluding narrows to bugs too: not trivial is every other bug.
    assert titles({"severity": "trivial", "severity_exclude": True}) == [
        "Critical in production",
        "Major in production",
        "Major on staging",
        "Unrated",
    ]
    assert titles({"found_in_id": found["id"]}) == ["Critical in production"]
    assert titles({"environment": "Staging", "environment_exclude": True}) == [
        "Critical in production",
        "Major in production",
        "Trivial, nowhere in particular",
        "Unrated",
    ]


def test_a_saved_view_keeps_them_and_a_bug_grouping(client, board):
    found = board["release"]("1.3")
    view = _ok(
        client.post(
            f"/teams/{board['team_id']}/views",
            json={
                "name": "Critical bugs found in 1.3 on production",
                "filters": {
                    "type": ["bug"],
                    "severity": ["critical"],
                    "environment": ["Production"],
                    "found_in_id": [found["id"]],
                },
                "group_by": "severity",
                "sort": "severity",
                "sort_direction": "desc",
            },
            headers=board["h"],
        )
    )
    filters = view["filters"]
    assert (
        filters["severity"],
        filters["environment"],
        filters["found_in_id"],
    ) == (["critical"], ["Production"], [found["id"]])
    assert (view["group_by"], view["sort"]) == ("severity", "severity")

    # Deleting the release takes it out of the view, and off the bugs.
    bug = board["bug"]("Found in 1.3", found_in_id=found["id"])
    assert (
        client.delete(f"/releases/{found['id']}", headers=board["h"]).status_code == 204
    )
    reread = _ok(client.get(f"/teams/{board['team_id']}/views", headers=board["h"]))
    assert reread["items"][0]["filters"]["found_in_id"] == []
    assert (
        _ok(client.get(f"/tickets/{bug['id']}", headers=board["h"]))["found_in_id"]
        is None
    )


def test_the_list_sorts_by_severity_with_the_unrated_last(client, board):
    for title, severity in (
        ("Minor", "minor"),
        ("Critical", "critical"),
        ("Trivial", "trivial"),
        ("Major", "major"),
    ):
        board["bug"](title, severity=severity)
    board["bug"]("Unrated")
    task = board["ticket"]("Task that kept one")
    _ok(board["patch"](task, type="bug", severity="critical"))
    _ok(board["patch"](task, type="task"))

    worst_first = board["titles"]({"sort": "severity", "direction": "desc"})
    assert worst_first[:4] == ["Critical", "Major", "Minor", "Trivial"]
    assert set(worst_first[4:]) == {"Unrated", "Task that kept one"}
    least_first = board["titles"]({"sort": "severity", "direction": "asc"})
    assert least_first[:4] == ["Trivial", "Minor", "Major", "Critical"]


def test_a_bulk_edit_rates_bugs_and_refuses_a_batch_with_a_task(client, board):
    bugs = [board["bug"](f"Bug {n}") for n in range(2)]
    task = board["ticket"]("A task")
    url = f"/teams/{board['team_id']}/tickets/bulk-update"

    rated = _ok(
        client.post(
            url,
            json={
                "ticket_ids": [bug["id"] for bug in bugs],
                "changes": {"severity": "minor", "environment": "staging"},
            },
            headers=board["h"],
        )
    )
    assert {(t["severity"], t["environment"]) for t in rated} == {("minor", "Staging")}

    refused = client.post(
        url,
        json={
            "ticket_ids": [bugs[0]["id"], task["id"]],
            "changes": {"severity": "critical"},
        },
        headers=board["h"],
    )
    _code(refused, 400, "bug_details_need_a_bug")
    # All or nothing: the bug in the batch kept what it had.
    assert (
        _ok(client.get(f"/tickets/{bugs[0]['id']}", headers=board["h"]))["severity"]
        == "minor"
    )


def test_open_bugs_by_severity_week_by_week(client, board, session):
    now = datetime.now(timezone.utc)
    board["bug"]("Critical", severity="critical")
    major = board["bug"]("Major", severity="major")
    board["bug"]("Unrated")
    board["ticket"]("Not a bug")
    fixed = board["bug"]("Fixed last week", severity="minor")

    # Backdate: all made three weeks ago; the minor one fixed two weeks ago.
    three_weeks = now - timedelta(weeks=3)
    two_weeks = now - timedelta(weeks=2)
    for ticket in session.exec(select(Ticket)).all():
        ticket.created_at = three_weeks
        session.add(ticket)
    for event in session.exec(select(TicketEvent)).all():
        event.created_at = three_weeks
        session.add(event)
    session.commit()
    _ok(board["patch"](fixed, status_id=board["done"]))
    closing = session.exec(
        select(TicketEvent).where(
            TicketEvent.ticket_id == fixed["id"],
            TicketEvent.field == TicketEventField.status,
            TicketEvent.opening == False,  # noqa: E712
        )
    ).one()
    closing.created_at = two_weeks
    session.add(closing)
    # And the major one only rated this week, having been unrated before.
    rated = session.exec(
        select(TicketEvent).where(
            TicketEvent.ticket_id == major["id"],
            TicketEvent.field == TicketEventField.severity,
        )
    ).one()
    rated.created_at = now
    session.add(rated)
    session.commit()

    weeks = _ok(
        client.get(
            f"/teams/{board['team_id']}/open-bugs-by-severity",
            params={"weeks": 4},
            headers=board["h"],
        )
    )["weeks"]
    assert len(weeks) == 4
    monday = now.date() - timedelta(days=now.date().weekday())
    assert weeks[-1]["week_of"] == monday.isoformat()

    def counts(week):
        return {
            key: week[key]
            for key in ("critical", "major", "minor", "trivial", "unrated")
        }

    # Three weeks back all four were open; the major one not yet rated.
    assert counts(weeks[-4]) == {
        "critical": 1,
        "major": 0,
        "minor": 1,
        "trivial": 0,
        "unrated": 2,
    }
    # Two weeks back the minor one was fixed; last week the major was unrated.
    assert counts(weeks[-2]) == {
        "critical": 1,
        "major": 0,
        "minor": 0,
        "trivial": 0,
        "unrated": 2,
    }
    assert counts(weeks[-1]) == {
        "critical": 1,
        "major": 1,
        "minor": 0,
        "trivial": 0,
        "unrated": 1,
    }


def test_the_export_carries_them_for_bugs(client, board):
    found = board["release"]("1.3.2")
    board["bug"](
        "A bug", severity="major", environment="Staging", found_in_id=found["id"]
    )
    task = board["ticket"]("A task that was a bug")
    _ok(board["patch"](task, type="bug", severity="critical"))
    _ok(board["patch"](task, type="task"))

    response = client.get(
        f"/teams/{board['team_id']}/tickets/export", headers=board["h"]
    )
    rows = {
        row["title"]: row
        for row in csv.DictReader(io.StringIO(response.content.decode("utf-8-sig")))
    }
    bug = rows["A bug"]
    assert (bug["bug_severity"], bug["bug_environment"], bug["found_in"]) == (
        "major",
        "Staging",
        "1.3.2",
    )
    kept = rows["A task that was a bug"]
    assert (kept["bug_severity"], kept["bug_environment"], kept["found_in"]) == (
        "",
        "",
        "",
    )


def test_moving_a_bug_to_another_team_keeps_only_what_that_team_has(
    client, board, session
):
    found = board["release"]("1.3.2")
    bug = board["bug"](
        "Moving", severity="major", environment="Staging", found_in_id=found["id"]
    )
    ops = _ok(
        client.post("/teams", json={"name": "Ops", "key": "OPS"}, headers=board["h"])
    )
    _ok(
        client.patch(
            f"/teams/{ops['id']}",
            json={"environments": ["Production"]},
            headers=board["h"],
        )
    )
    _ok(
        client.post(
            f"/tickets/{bug['id']}/transfer",
            json={"team_id": ops["id"]},
            headers=board["h"],
        )
    )
    moved = session.get(Ticket, bug["id"], execution_options=INCLUDE_TRASHED)
    session.refresh(moved)
    assert (moved.severity.value, moved.environment, moved.found_in_id) == (
        "major",
        None,
        None,
    )


JIRA_CSV = """Summary,Issue key,Issue Type,Status,Priority,Fix Version/s,Fix Version/s,Affects Version/s,Custom field (Severity),Environment
Invoice PDF blank,PORT-1,Bug,In Progress,High,1.4.0,1.4.1,1.3.2,Blocker,Production
Portal invoice list,PORT-2,Story,Done,Medium,1.4.0,,,Major,Production
Login slow,PORT-3,Bug,To Do,Low,,,1.3.2,minor,QA lab
Typo on pricing,PORT-4,Bug,To Do,Low,,,,trivial,"Chrome 117 on macOS 14, with the corporate VPN on and the cache cleared first"
"""


def test_the_jira_import_carries_versions_severity_and_environment(client, board):
    response = client.post(
        f"/teams/{board['team_id']}/import/jira",
        data={"dry_run": "false"},
        files={"file": ("export.csv", JIRA_CSV.encode(), "text/csv")},
        headers=board["h"],
    )
    report = _ok(response)
    assert report["releases_created"] == ["1.4.0", "1.3.2"]
    assert report["environments_added"] == ["QA lab"]
    assert any("more than one version" in w for w in report["warnings"])
    assert any("environment at more length" in w for w in report["warnings"])

    tickets = {
        ticket["external_key"]: ticket
        for ticket in _ok(
            client.get(f"/teams/{board['team_id']}/tickets", headers=board["h"])
        )["items"]
    }
    releases = {
        release["name"]: release["id"]
        for release in _ok(
            client.get(f"/teams/{board['team_id']}/releases", headers=board["h"])
        )
    }
    pdf = tickets["PORT-1"]
    assert (pdf["severity"], pdf["environment"]) == ("critical", "Production")
    assert pdf["fix_version_id"] == releases["1.4.0"]
    assert pdf["found_in_id"] == releases["1.3.2"]
    # A story ships in a release, and has no bug details.
    story = tickets["PORT-2"]
    assert story["fix_version_id"] == releases["1.4.0"]
    assert (story["severity"], story["environment"]) == (None, None)
    assert tickets["PORT-3"]["environment"] == "QA lab"
    assert tickets["PORT-4"]["environment"] is None
    assert tickets["PORT-4"]["severity"] == "trivial"

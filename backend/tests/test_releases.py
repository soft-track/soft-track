"""Releases (#272): the versions a team ships, a fix version on a ticket, and
release notes.

A release belongs to a team and has a name, a description, a target date and
a state. A ticket has one fix version. Releasing sets the day and asks what
to do with what is not done; release notes are drafted from what is done,
by type. The board filters on a release and a saved view keeps it, and a
rule can set one.
"""

import csv
import io

import pytest
from sqlmodel import select

from lib_softtrack.tables import AutomationRule, SavedView, Ticket
from lib_softtrack.trash import INCLUDE_TRASHED


def _ok(response):
    assert response.status_code == 200, response.text
    return response.json()


def _code(response, status, code):
    assert response.status_code == status, response.text
    assert response.json()["code"] == code, response.text


@pytest.fixture
def board(client, team):
    """Engineering with a release, 1.4.0, and a ticket helper."""
    team_id = team["team"]["id"]
    h = team["headers"]

    def release(name, **fields):
        return _ok(
            client.post(
                f"/teams/{team_id}/releases", json={"name": name, **fields}, headers=h
            )
        )

    def ticket(title, **fields):
        return _ok(
            client.post(
                f"/teams/{team_id}/tickets", json={"title": title, **fields}, headers=h
            )
        )

    return {
        **team,
        "team_id": team_id,
        "h": h,
        "release": release,
        "ticket": ticket,
        "done": team["status_ids"]["Done"],
        "cancelled": team["status_ids"]["Cancelled"],
        "doing": team["status_ids"]["In Progress"],
    }


def test_a_team_makes_a_release_and_lists_it(client, board):
    made = board["release"](
        "1.4.0",
        description="The customer portal, for the first three customers.",
        target_date="2026-10-15",
    )
    assert made["name"] == "1.4.0"
    assert made["state"] == "planned"
    assert made["target_date"] == "2026-10-15"
    assert made["released_on"] is None
    assert made["progress"] == {
        "tickets_total": 0,
        "tickets_done": 0,
        "points_total": 0,
        "points_done": 0,
        "tickets_unestimated": 0,
    }

    listed = _ok(client.get(f"/teams/{board['team_id']}/releases", headers=board["h"]))
    assert [release["name"] for release in listed] == ["1.4.0"]
    assert _ok(client.get(f"/releases/{made['id']}", headers=board["h"])) == made


def test_a_name_is_once_per_team_and_never_blank(client, board, auth):
    board["release"]("1.4.0")
    again = client.post(
        f"/teams/{board['team_id']}/releases",
        json={"name": " 1.4.0 "},
        headers=board["h"],
    )
    _code(again, 409, "release_name_taken")
    blank = client.post(
        f"/teams/{board['team_id']}/releases",
        json={"name": "   "},
        headers=board["h"],
    )
    assert blank.status_code == 422

    # Another team may have its own 1.4.0.
    other = auth(email="ops@example.com", full_name="Ops Person")
    ops = _ok(
        client.post(
            "/teams", json={"name": "Ops", "key": "OPS"}, headers=other["headers"]
        )
    )
    assert (
        client.post(
            f"/teams/{ops['id']}/releases",
            json={"name": "1.4.0"},
            headers=other["headers"],
        ).status_code
        == 200
    )


def test_releases_list_planned_then_released_then_archived(client, board):
    old = board["release"]("1.3.0", target_date="2026-08-01")
    newer = board["release"]("1.3.2", target_date="2026-09-01")
    next_one = board["release"]("1.4.0", target_date="2026-10-15")
    later = board["release"]("1.5.0", target_date="2026-12-01")
    undecided = board["release"]("2.0.0")
    for release, day in ((old, "2026-08-02"), (newer, "2026-09-03")):
        _ok(
            client.post(
                f"/releases/{release['id']}/release",
                json={"released_on": day},
                headers=board["h"],
            )
        )
    gone = board["release"]("0.9.0")
    _ok(
        client.patch(
            f"/releases/{gone['id']}", json={"state": "archived"}, headers=board["h"]
        )
    )

    listed = _ok(client.get(f"/teams/{board['team_id']}/releases", headers=board["h"]))
    assert [release["name"] for release in listed] == [
        undecided["name"],
        later["name"],
        next_one["name"],
        newer["name"],
        old["name"],
        gone["name"],
    ]


def test_a_ticket_has_one_fix_version_on_its_own_team(client, board, auth):
    release = board["release"]("1.4.0")
    ticket = board["ticket"]("Portal: invoice list page", fix_version_id=release["id"])
    assert ticket["fix_version_id"] == release["id"]

    cleared = _ok(
        client.patch(
            f"/tickets/{ticket['id']}",
            json={"fix_version_id": None},
            headers=board["h"],
        )
    )
    assert cleared["fix_version_id"] is None

    other = auth(email="ops@example.com", full_name="Ops Person")
    ops = _ok(
        client.post(
            "/teams", json={"name": "Ops", "key": "OPS"}, headers=other["headers"]
        )
    )
    theirs = _ok(
        client.post(
            f"/teams/{ops['id']}/releases",
            json={"name": "9.9"},
            headers=other["headers"],
        )
    )
    refused = client.patch(
        f"/tickets/{ticket['id']}",
        json={"fix_version_id": theirs["id"]},
        headers=board["h"],
    )
    _code(refused, 400, "not_on_this_team")
    refused = client.post(
        f"/teams/{board['team_id']}/tickets",
        json={"title": "Elsewhere", "fix_version_id": theirs["id"]},
        headers=board["h"],
    )
    _code(refused, 400, "not_on_this_team")


def test_the_history_says_which_release_and_by_name(client, board):
    first = board["release"]("1.4.0")
    second = board["release"]("1.5.0")
    ticket = board["ticket"]("Totals round differently")
    for release in (first, second):
        _ok(
            client.patch(
                f"/tickets/{ticket['id']}",
                json={"fix_version_id": release["id"]},
                headers=board["h"],
            )
        )
    events = _ok(client.get(f"/tickets/{ticket['id']}/events", headers=board["h"]))
    moves = [event for event in events if event["field"] == "fix_version"]
    assert [(e["old_label"], e["new_label"]) for e in moves] == [
        (None, "1.4.0"),
        ("1.4.0", "1.5.0"),
    ]


def test_progress_counts_tickets_and_points_and_leaves_out_cancelled(client, board):
    release = board["release"]("1.4.0")
    rid = release["id"]
    board["ticket"]("Done", fix_version_id=rid, estimate=3, status_id=board["done"])
    board["ticket"](
        "Also done", fix_version_id=rid, estimate=5, status_id=board["done"]
    )
    board["ticket"]("Doing", fix_version_id=rid, estimate=8, status_id=board["doing"])
    board["ticket"]("Unsized", fix_version_id=rid)
    board["ticket"](
        "Dropped", fix_version_id=rid, estimate=8, status_id=board["cancelled"]
    )
    board["ticket"]("Elsewhere", estimate=8)

    progress = _ok(client.get(f"/releases/{rid}", headers=board["h"]))["progress"]
    assert progress == {
        "tickets_total": 4,
        "tickets_done": 2,
        "points_total": 16,
        "points_done": 8,
        "tickets_unestimated": 1,
    }


def test_releasing_moves_what_is_not_done_to_the_next_release(client, board):
    release = board["release"]("1.4.0")
    following = board["release"]("1.5.0")
    rid = release["id"]
    shipped = board["ticket"]("Shipped", fix_version_id=rid, status_id=board["done"])
    dropped = board["ticket"](
        "Dropped", fix_version_id=rid, status_id=board["cancelled"]
    )
    open_one = board["ticket"]("Regression pass", fix_version_id=rid)
    doing = board["ticket"]("Safari PDF", fix_version_id=rid, status_id=board["doing"])

    result = _ok(
        client.post(
            f"/releases/{rid}/release",
            json={"released_on": "2026-10-15", "move_to_release_id": following["id"]},
            headers=board["h"],
        )
    )
    assert result["moved"] == 2
    assert result["moved_to_release_id"] == following["id"]
    assert result["release"]["state"] == "released"
    assert result["release"]["released_on"] == "2026-10-15"

    def fix_version(ticket):
        return _ok(client.get(f"/tickets/{ticket['id']}", headers=board["h"]))[
            "fix_version_id"
        ]

    assert fix_version(shipped) == rid
    # Cancelled is not waiting for anything, and stays where it was.
    assert fix_version(dropped) == rid
    assert fix_version(open_one) == following["id"]
    assert fix_version(doing) == following["id"]

    # Moving it on is in the ticket's history, by name and by who.
    events = _ok(client.get(f"/tickets/{doing['id']}/events", headers=board["h"]))
    moved = [event for event in events if event["field"] == "fix_version"][-1]
    assert (moved["old_label"], moved["new_label"]) == ("1.4.0", "1.5.0")
    assert moved["actor"]["id"] == board["user"]["id"]


def test_releasing_can_leave_what_is_not_done_without_a_release(client, board):
    release = board["release"]("1.4.0")
    open_one = board["ticket"]("Regression pass", fix_version_id=release["id"])

    result = _ok(client.post(f"/releases/{release['id']}/release", headers=board["h"]))
    assert result["moved"] == 1
    assert result["moved_to_release_id"] is None
    # Today, when nobody said which day.
    assert result["release"]["released_on"] is not None
    assert (
        _ok(client.get(f"/tickets/{open_one['id']}", headers=board["h"]))[
            "fix_version_id"
        ]
        is None
    )


def test_a_release_ships_once_and_only_into_one_still_to_come(client, board):
    release = board["release"]("1.4.0")
    gone = board["release"]("1.3.2")
    _ok(client.post(f"/releases/{gone['id']}/release", headers=board["h"]))

    into_gone = client.post(
        f"/releases/{release['id']}/release",
        json={"move_to_release_id": gone["id"]},
        headers=board["h"],
    )
    _code(into_gone, 409, "release_not_planned")
    into_itself = client.post(
        f"/releases/{release['id']}/release",
        json={"move_to_release_id": release["id"]},
        headers=board["h"],
    )
    _code(into_itself, 409, "release_not_planned")
    nowhere = client.post(
        f"/releases/{release['id']}/release",
        json={"move_to_release_id": 999_999},
        headers=board["h"],
    )
    _code(nowhere, 400, "not_on_this_team")

    _ok(client.post(f"/releases/{release['id']}/release", headers=board["h"]))
    again = client.post(f"/releases/{release['id']}/release", headers=board["h"])
    _code(again, 409, "release_not_planned")
    assert again.json()["detail"] == "1.4.0 has been released already."


def test_release_notes_are_drafted_from_what_is_done_by_type(client, board):
    release = board["release"]("1.4.0", description="The customer portal.")
    rid = release["id"]
    done = board["done"]
    board["ticket"](
        "Portal: invoice list page", type="story", fix_version_id=rid, status_id=done
    )
    magic = board["ticket"](
        "Portal: sign-in with magic link",
        type="story",
        fix_version_id=rid,
        status_id=done,
    )
    board["ticket"](
        "Totals round differently in the PDF",
        type="bug",
        fix_version_id=rid,
        status_id=done,
    )
    board["ticket"](
        "Bump the PDF library", type="task", fix_version_id=rid, status_id=done
    )
    # Part of a story that is in the notes: left to the story.
    board["ticket"](
        "Email template", fix_version_id=rid, status_id=done, parent_id=magic["id"]
    )
    board["ticket"]("Regression pass", fix_version_id=rid)
    board["ticket"]("Dropped", fix_version_id=rid, status_id=board["cancelled"])
    board["ticket"]("Not in it", type="story", status_id=done)
    _ok(
        client.post(
            f"/releases/{rid}/release",
            json={"released_on": "2026-10-15"},
            headers=board["h"],
        )
    )

    notes = _ok(client.get(f"/releases/{rid}/notes", headers=board["h"]))
    assert notes["markdown"] == (
        "# 1.4.0\n"
        "\n"
        "Released 15 October 2026.\n"
        "\n"
        "The customer portal.\n"
        "\n"
        "## Stories\n"
        "\n"
        "- Portal: invoice list page (ENG-1)\n"
        "- Portal: sign-in with magic link (ENG-2)\n"
        "\n"
        "## Bugs fixed\n"
        "\n"
        "- Totals round differently in the PDF (ENG-3)\n"
        "\n"
        "## Tasks\n"
        "\n"
        "- Bump the PDF library (ENG-4)\n"
    )


def test_release_notes_leave_out_a_section_with_nothing_in_it(client, board):
    release = board["release"]("1.4.1")
    board["ticket"](
        "Hotfix", type="bug", fix_version_id=release["id"], status_id=board["done"]
    )
    notes = _ok(client.get(f"/releases/{release['id']}/notes", headers=board["h"]))
    assert notes["markdown"] == ("# 1.4.1\n\n## Bugs fixed\n\n- Hotfix (ENG-1)\n")


def test_editing_archiving_and_reopening_a_release(client, board):
    release = board["release"]("1.4.0", target_date="2026-10-15")
    rid = release["id"]

    edited = _ok(
        client.patch(
            f"/releases/{rid}",
            json={"name": "1.4.0-rc", "description": "  ", "target_date": None},
            headers=board["h"],
        )
    )
    assert (edited["name"], edited["description"], edited["target_date"]) == (
        "1.4.0-rc",
        None,
        None,
    )

    # Marking it released by hand would skip the question releasing asks.
    by_hand = client.patch(
        f"/releases/{rid}", json={"state": "released"}, headers=board["h"]
    )
    _code(by_hand, 409, "release_not_released")
    early = client.patch(
        f"/releases/{rid}", json={"released_on": "2026-10-16"}, headers=board["h"]
    )
    _code(early, 409, "release_not_released")

    _ok(
        client.post(
            f"/releases/{rid}/release",
            json={"released_on": "2026-10-15"},
            headers=board["h"],
        )
    )
    corrected = _ok(
        client.patch(
            f"/releases/{rid}", json={"released_on": "2026-10-16"}, headers=board["h"]
        )
    )
    assert corrected["released_on"] == "2026-10-16"

    archived = _ok(
        client.patch(f"/releases/{rid}", json={"state": "archived"}, headers=board["h"])
    )
    assert (archived["state"], archived["released_on"]) == ("archived", "2026-10-16")
    back = _ok(
        client.patch(f"/releases/{rid}", json={"state": "released"}, headers=board["h"])
    )
    assert back["state"] == "released"

    reopened = _ok(
        client.patch(f"/releases/{rid}", json={"state": "planned"}, headers=board["h"])
    )
    assert (reopened["state"], reopened["released_on"]) == ("planned", None)

    taken = board["release"]("1.5.0")
    clash = client.patch(
        f"/releases/{taken['id']}", json={"name": "1.4.0-rc"}, headers=board["h"]
    )
    _code(clash, 409, "release_name_taken")


def test_deleting_a_release_leaves_its_tickets_views_and_rules_without_it(
    client, board, session
):
    release = board["release"]("1.4.0")
    rid = release["id"]
    kept = board["release"]("1.5.0")
    ticket = board["ticket"]("Portal", fix_version_id=rid)
    trashed = board["ticket"]("Gone for now", fix_version_id=rid)
    assert (
        client.delete(f"/tickets/{trashed['id']}", headers=board["h"]).status_code
        == 204
    )
    view = _ok(
        client.post(
            f"/teams/{board['team_id']}/views",
            json={
                "name": "Shipping",
                "filters": {"fix_version_id": [rid, kept["id"]]},
            },
            headers=board["h"],
        )
    )
    rule = _ok(
        client.post(
            f"/teams/{board['team_id']}/automation-rules",
            json={
                "name": "Into 1.4.0",
                "trigger": "ticket_created",
                "conditions": {"if_type": "bug"},
                "actions": {"set_fix_version_id": rid},
            },
            headers=board["h"],
        )
    )

    assert client.delete(f"/releases/{rid}", headers=board["h"]).status_code == 204
    _code(client.get(f"/releases/{rid}", headers=board["h"]), 404, "release_not_found")

    assert (
        _ok(client.get(f"/tickets/{ticket['id']}", headers=board["h"]))[
            "fix_version_id"
        ]
        is None
    )
    in_trash = session.get(Ticket, trashed["id"], execution_options=INCLUDE_TRASHED)
    assert in_trash.fix_version_id is None
    events = _ok(client.get(f"/tickets/{ticket['id']}/events", headers=board["h"]))
    assert events[-1]["field"] == "fix_version"
    assert events[-1]["new_value"] is None

    session.expire_all()
    assert session.get(SavedView, view["id"]).fix_version_ids == [kept["id"]]
    stored = session.get(AutomationRule, rule["id"])
    assert (stored.set_fix_version_id, stored.is_enabled) == (None, False)


def test_the_board_filters_on_a_release_and_on_having_none(client, board):
    first = board["release"]("1.4.0")
    second = board["release"]("1.5.0")
    a = board["ticket"]("In 1.4.0", fix_version_id=first["id"])
    b = board["ticket"]("In 1.5.0", fix_version_id=second["id"])
    c = board["ticket"]("In none")

    def titles(params):
        page = _ok(
            client.get(
                f"/teams/{board['team_id']}/tickets",
                params=params,
                headers=board["h"],
            )
        )
        return sorted(ticket["title"] for ticket in page["items"])

    assert titles({"fix_version_id": first["id"]}) == [a["title"]]
    assert titles({"fix_version_id": [first["id"], second["id"]]}) == sorted(
        [a["title"], b["title"]]
    )
    # Every release but 1.4.0 -- and no release at all, which is not 1.4.0.
    assert titles(
        {"fix_version_id": first["id"], "fix_version_exclude": True}
    ) == sorted([b["title"], c["title"]])
    assert titles({"has_no": "fix_version"}) == [c["title"]]


def test_a_saved_view_keeps_a_release_filter_and_a_release_grouping(client, board):
    release = board["release"]("1.4.0")
    view = _ok(
        client.post(
            f"/teams/{board['team_id']}/views",
            json={
                "name": "1.4.0",
                "filters": {"fix_version_id": [release["id"]], "has_no": ["sprint"]},
                "group_by": "release",
            },
            headers=board["h"],
        )
    )
    assert view["filters"]["fix_version_id"] == [release["id"]]
    assert view["filters"]["fix_version_exclude"] is False
    assert view["group_by"] == "release"


def test_a_view_cannot_name_another_teams_release(client, board, auth):
    other = auth(email="ops@example.com", full_name="Ops Person")
    ops = _ok(
        client.post(
            "/teams", json={"name": "Ops", "key": "OPS"}, headers=other["headers"]
        )
    )
    theirs = _ok(
        client.post(
            f"/teams/{ops['id']}/releases",
            json={"name": "9.9"},
            headers=other["headers"],
        )
    )
    refused = client.post(
        f"/teams/{board['team_id']}/views",
        json={"name": "Theirs", "filters": {"fix_version_id": [theirs["id"]]}},
        headers=board["h"],
    )
    _code(refused, 400, "not_on_this_team")


def test_a_bulk_edit_sets_the_fix_version(client, board):
    release = board["release"]("1.4.0")
    tickets = [board["ticket"](f"Ticket {n}") for n in range(3)]
    updated = _ok(
        client.post(
            f"/teams/{board['team_id']}/tickets/bulk-update",
            json={
                "ticket_ids": [ticket["id"] for ticket in tickets],
                "changes": {"fix_version_id": release["id"]},
            },
            headers=board["h"],
        )
    )
    assert {ticket["fix_version_id"] for ticket in updated} == {release["id"]}


def test_a_rule_sets_the_fix_version_of_a_release_still_to_come(client, board):
    release = board["release"]("1.4.0")
    _ok(
        client.post(
            f"/teams/{board['team_id']}/automation-rules",
            json={
                "name": "Bugs into 1.4.0",
                "trigger": "ticket_created",
                "conditions": {"if_type": "bug"},
                "actions": {"set_fix_version_id": release["id"]},
            },
            headers=board["h"],
        )
    )
    bug = board["ticket"]("Invoice PDF blank on Safari", type="bug")
    assert bug["fix_version_id"] == release["id"]
    runs = _ok(
        client.get(f"/teams/{board['team_id']}/automation-runs", headers=board["h"])
    )["items"]
    assert runs[0]["summary"] == "Set the fix version to 1.4.0"

    # Once it has shipped, the rule skips it and says why.
    _ok(client.post(f"/releases/{release['id']}/release", headers=board["h"]))
    later = board["ticket"]("Another bug", type="bug")
    assert later["fix_version_id"] is None
    runs = _ok(
        client.get(f"/teams/{board['team_id']}/automation-runs", headers=board["h"])
    )["items"]
    assert runs[0]["summary"] == (
        "Did not set the fix version to 1.4.0, which is no longer a release to come"
    )

    # And a new rule cannot name it at all.
    refused = client.post(
        f"/teams/{board['team_id']}/automation-rules",
        json={
            "name": "Into the past",
            "trigger": "ticket_created",
            "actions": {"set_fix_version_id": release["id"]},
        },
        headers=board["h"],
    )
    _code(refused, 400, "release_not_planned")


def test_the_export_names_the_fix_version(client, board):
    release = board["release"]("1.4.0")
    board["ticket"]("In it", fix_version_id=release["id"])
    response = client.get(
        f"/teams/{board['team_id']}/tickets/export", headers=board["h"]
    )
    assert response.status_code == 200, response.text
    rows = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert rows[0]["fix_version"] == "1.4.0"


def test_moving_a_ticket_to_another_team_leaves_the_release_behind(
    client, board, auth, session
):
    release = board["release"]("1.4.0")
    ticket = board["ticket"]("Moving", fix_version_id=release["id"])
    ops = _ok(
        client.post("/teams", json={"name": "Ops", "key": "OPS"}, headers=board["h"])
    )
    _ok(
        client.post(
            f"/tickets/{ticket['id']}/transfer",
            json={"team_id": ops["id"]},
            headers=board["h"],
        )
    )
    assert (
        session.exec(select(Ticket).where(Ticket.id == ticket["id"]))
        .one()
        .fix_version_id
        is None
    )


def test_a_team_with_releases_can_still_be_deleted_while_empty(client, board):
    board["release"]("1.4.0")
    assert (
        client.delete(f"/teams/{board['team_id']}", headers=board["h"]).status_code
        == 204
    )

"""Time estimates in hours, with remaining against logged (#268)."""

import csv
import io
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlmodel import select

from lib_softtrack.tables import Ticket, TicketEvent, TicketEventField

H = 60


def _ok(response):
    assert response.status_code == 200, response.text
    return response.json()


def make_ticket(client, team, title="Magic link", **fields):
    return _ok(
        client.post(
            f"/teams/{team['team']['id']}/tickets",
            json={"title": title, **fields},
            headers=team["headers"],
        )
    )


def patch(client, team, ticket, expect=200, **fields):
    response = client.patch(
        f"/tickets/{ticket['id']}", json=fields, headers=team["headers"]
    )
    assert response.status_code == expect, response.text
    return response.json()


def log(client, team, ticket, minutes, **fields):
    return _ok(
        client.post(
            f"/tickets/{ticket['id']}/worklogs",
            json={"minutes": minutes, **fields},
            headers=team["headers"],
        )
    )


def estimate_of(client, team, ticket):
    return _ok(
        client.get(f"/tickets/{ticket['id']}/time-estimate", headers=team["headers"])
    )


def status_id(client, team, category):
    statuses = _ok(
        client.get(f"/teams/{team['team']['id']}/statuses", headers=team["headers"])
    )
    return next(s["id"] for s in statuses if s["category"] == category)


# --- the team's choice ------------------------------------------------------


def test_a_team_estimates_in_points_until_an_admin_chooses(client, team):
    assert team["team"]["estimate_unit"] == "points"
    changed = _ok(
        client.patch(
            f"/teams/{team['team']['id']}",
            json={"estimate_unit": "both"},
            headers=team["headers"],
        )
    )
    assert changed["estimate_unit"] == "both"
    refused = client.patch(
        f"/teams/{team['team']['id']}",
        json={"estimate_unit": "days"},
        headers=team["headers"],
    )
    assert refused.status_code == 422


# --- one ticket -------------------------------------------------------------


def test_a_time_estimate_sits_beside_the_points(client, team):
    ticket = make_ticket(client, team, estimate=5)
    updated = patch(client, team, ticket, time_estimate_minutes=10 * H)
    assert updated["estimate"] == 5
    assert updated["time_estimate_minutes"] == 10 * H
    assert updated["remaining_minutes"] is None

    cleared = patch(client, team, ticket, time_estimate_minutes=None)
    assert cleared["time_estimate_minutes"] is None
    assert cleared["estimate"] == 5


@pytest.mark.parametrize("minutes", [0, -30, 1000 * H + 1])
def test_a_time_estimate_is_some_time_and_not_absurd(client, team, minutes):
    ticket = make_ticket(client, team)
    patch(client, team, ticket, expect=422, time_estimate_minutes=minutes)


def test_remaining_is_the_estimate_less_what_is_logged(client, team):
    ticket = make_ticket(client, team)
    patch(client, team, ticket, time_estimate_minutes=10 * H)
    log(client, team, ticket, 4 * H)
    log(client, team, ticket, 3 * H)

    estimate = estimate_of(client, team, ticket)
    assert estimate["estimated_minutes"] == 10 * H
    assert estimate["logged_minutes"] == 7 * H
    assert estimate["remaining_minutes"] == 3 * H
    assert estimate["remaining_set"] is False
    assert estimate["total"] == {
        "estimated_minutes": 10 * H,
        "logged_minutes": 7 * H,
        "remaining_minutes": 3 * H,
    }


def test_remaining_never_goes_below_nothing(client, team):
    ticket = make_ticket(client, team)
    patch(client, team, ticket, time_estimate_minutes=6 * H)
    log(client, team, ticket, 10 * H)
    assert estimate_of(client, team, ticket)["remaining_minutes"] == 0


def test_without_an_estimate_there_is_nothing_to_work_out(client, team):
    ticket = make_ticket(client, team)
    log(client, team, ticket, 2 * H)
    estimate = estimate_of(client, team, ticket)
    assert estimate["estimated_minutes"] is None
    assert estimate["remaining_minutes"] is None
    assert estimate["total"]["logged_minutes"] == 2 * H


def test_logging_time_can_say_what_is_left(client, team):
    ticket = make_ticket(client, team)
    patch(client, team, ticket, time_estimate_minutes=10 * H)
    log(client, team, ticket, 7 * H)
    # The worked-out answer is 0h; whoever logs it knows there is an hour more.
    log(client, team, ticket, 3 * H, remaining_minutes=1 * H)

    estimate = estimate_of(client, team, ticket)
    assert estimate["remaining_minutes"] == 1 * H
    assert estimate["remaining_set"] is True


def test_remaining_set_by_hand_goes_down_as_time_is_logged(client, team):
    ticket = make_ticket(client, team)
    patch(client, team, ticket, time_estimate_minutes=10 * H)
    patch(client, team, ticket, remaining_minutes=5 * H)
    log(client, team, ticket, 2 * H)
    assert estimate_of(client, team, ticket)["remaining_minutes"] == 3 * H
    log(client, team, ticket, 4 * H)
    assert estimate_of(client, team, ticket)["remaining_minutes"] == 0


def test_remaining_can_be_handed_back_to_the_sum(client, team):
    ticket = make_ticket(client, team)
    patch(client, team, ticket, time_estimate_minutes=10 * H, remaining_minutes=H)
    log(client, team, ticket, 2 * H, remaining_minutes=None)
    estimate = estimate_of(client, team, ticket)
    assert estimate["remaining_set"] is False
    assert estimate["remaining_minutes"] == 8 * H


def test_logging_without_an_answer_leaves_a_worked_out_remaining_alone(
    client, team, session
):
    ticket = make_ticket(client, team)
    patch(client, team, ticket, time_estimate_minutes=10 * H)
    log(client, team, ticket, 2 * H)
    assert session.get(Ticket, ticket["id"]).remaining_minutes is None


def test_finished_work_has_nothing_left(client, team):
    ticket = make_ticket(client, team)
    patch(client, team, ticket, time_estimate_minutes=10 * H)
    log(client, team, ticket, 2 * H)
    patch(client, team, ticket, status_id=status_id(client, team, "done"))
    assert estimate_of(client, team, ticket)["remaining_minutes"] == 0


def test_a_parent_adds_its_subtickets(client, team):
    parent = make_ticket(client, team, "Portal")
    patch(client, team, parent, time_estimate_minutes=2 * H)
    first = make_ticket(client, team, "Form", parent_id=parent["id"])
    second = make_ticket(client, team, "Email", parent_id=parent["id"])
    patch(client, team, first, time_estimate_minutes=5 * H)
    patch(client, team, second, time_estimate_minutes=3 * H)
    log(client, team, parent, 1 * H)
    log(client, team, first, 4 * H)

    estimate = estimate_of(client, team, parent)
    # Its own figures are what logging on it works from...
    assert estimate["estimated_minutes"] == 2 * H
    assert estimate["remaining_minutes"] == 1 * H
    # ...and its total is the bar.
    assert estimate["subticket_count"] == 2
    assert estimate["total"] == {
        "estimated_minutes": 10 * H,
        "logged_minutes": 5 * H,
        "remaining_minutes": 1 * H + 1 * H + 3 * H,
    }


def test_changes_are_in_the_history(client, team, session):
    ticket = make_ticket(client, team)
    patch(client, team, ticket, time_estimate_minutes=10 * H)
    log(client, team, ticket, 3 * H, remaining_minutes=2 * H)
    events = session.exec(
        select(TicketEvent.field, TicketEvent.old_value, TicketEvent.new_value)
        .where(TicketEvent.ticket_id == ticket["id"])
        .order_by(TicketEvent.id)
    ).all()
    assert (TicketEventField.time_estimate, None, "600") in events
    assert (TicketEventField.remaining, None, "120") in events


def test_another_team_cannot_read_a_ticket_estimate(client, team, auth):
    ticket = make_ticket(client, team)
    outsider = auth(email="out@softtrack.dev")
    response = client.get(
        f"/tickets/{ticket['id']}/time-estimate", headers=outsider["headers"]
    )
    assert response.status_code == 403


# --- a sprint and an epic ----------------------------------------------------


@pytest.fixture
def planned(client, team):
    """A sprint and an epic sharing three tickets, one of them over."""
    team_id = team["team"]["id"]
    sprint = _ok(
        client.post(
            f"/teams/{team_id}/sprints",
            json={"starts_at": "2026-10-05", "ends_at": "2026-10-19"},
            headers=team["headers"],
        )
    )
    epic = _ok(
        client.post(
            f"/teams/{team_id}/projects",
            json={"name": "Customer portal"},
            headers=team["headers"],
        )
    )
    on_track = make_ticket(
        client, team, "Sign-in", sprint_id=sprint["id"], project_id=epic["id"]
    )
    over = make_ticket(
        client, team, "Totals round", sprint_id=sprint["id"], project_id=epic["id"]
    )
    unsized = make_ticket(client, team, "Copy", sprint_id=sprint["id"])
    patch(client, team, on_track, time_estimate_minutes=10 * H)
    patch(client, team, over, time_estimate_minutes=6 * H)
    log(client, team, on_track, 7 * H)
    log(client, team, over, 10 * H)
    log(client, team, unsized, 1 * H)
    return {"sprint": sprint, "epic": epic, "over": over}


def test_a_sprint_adds_up(client, team, planned):
    time = _ok(
        client.get(f"/sprints/{planned['sprint']['id']}/time", headers=team["headers"])
    )
    assert time["estimated_minutes"] == 16 * H
    assert time["logged_minutes"] == 18 * H
    assert time["remaining_minutes"] == 3 * H
    assert time["over"] == [
        {
            "id": planned["over"]["id"],
            "team_key": planned["over"]["team_key"],
            "number": planned["over"]["number"],
            "identifier": planned["over"]["identifier"],
            "title": "Totals round",
            "estimated_minutes": 6 * H,
            "logged_minutes": 10 * H,
            "remaining_minutes": 0,
        }
    ]


def test_an_epic_adds_up(client, team, planned):
    time = _ok(
        client.get(f"/projects/{planned['epic']['id']}/time", headers=team["headers"])
    )
    assert time["estimated_minutes"] == 16 * H
    assert time["logged_minutes"] == 17 * H
    assert time["remaining_minutes"] == 3 * H
    assert [ticket["title"] for ticket in time["over"]] == ["Totals round"]


def test_an_epic_adds_the_subtickets_of_its_tickets(client, team, planned):
    child = make_ticket(client, team, "Rounding", parent_id=planned["over"]["id"])
    patch(client, team, child, time_estimate_minutes=2 * H)
    log(client, team, child, 1 * H)
    for path in (
        f"/projects/{planned['epic']['id']}/time",
        f"/sprints/{planned['sprint']['id']}/time",
    ):
        time = _ok(client.get(path, headers=team["headers"]))
        assert time["estimated_minutes"] == 18 * H, path
        assert time["remaining_minutes"] == 4 * H, path


def test_trashed_tickets_leave_the_totals(client, team, planned):
    client.delete(f"/tickets/{planned['over']['id']}", headers=team["headers"])
    time = _ok(
        client.get(f"/sprints/{planned['sprint']['id']}/time", headers=team["headers"])
    )
    assert time["estimated_minutes"] == 10 * H
    assert time["over"] == []


def test_totals_group_by_anything_on_the_ticket(client, team, planned, session):
    from lib_softtrack.time_estimates import totals_by

    by_sprint = totals_by(
        session, Ticket.sprint_id, Ticket.team_id == team["team"]["id"]
    )
    assert by_sprint[planned["sprint"]["id"]].remaining_minutes == 3 * H


def test_another_team_cannot_read_a_sprint_or_epic_total(client, team, auth, planned):
    outsider = auth(email="out@softtrack.dev")
    for path in (
        f"/sprints/{planned['sprint']['id']}/time",
        f"/projects/{planned['epic']['id']}/time",
    ):
        assert client.get(path, headers=outsider["headers"]).status_code == 403


# --- the burndown, the filter and the export ---------------------------------


def test_the_burndown_can_be_drawn_in_remaining_hours(client, team, session):
    start = datetime.now(timezone.utc) - 2 * timedelta(days=1)
    sprint = _ok(
        client.post(
            f"/teams/{team['team']['id']}/sprints",
            json={
                "starts_at": start.isoformat(),
                "ends_at": (start + timedelta(days=10)).isoformat(),
            },
            headers=team["headers"],
        )
    )
    ticket = make_ticket(client, team, sprint_id=sprint["id"])
    patch(client, team, ticket, time_estimate_minutes=10 * H)
    for event in session.exec(select(TicketEvent)).all():
        event.created_at = start
        session.add(event)
    session.commit()
    yesterday = date.today() - timedelta(days=1)
    log(client, team, ticket, 3 * H, worked_on=yesterday.isoformat())
    log(client, team, ticket, 2 * H)

    points = _ok(
        client.get(f"/sprints/{sprint['id']}/burndown", headers=team["headers"])
    )["points"]
    assert [point["minutes_remaining"] for point in points] == [10 * H, 7 * H, 5 * H]
    assert points[-1]["minutes_logged"] == 5 * H
    assert points[-1]["minutes_total"] == 10 * H
    assert points[0]["ideal_minutes_remaining"] == 10 * H


def _missing_estimate(client, team):
    page = _ok(
        client.get(
            f"/teams/{team['team']['id']}/tickets?has_no=estimate",
            headers=team["headers"],
        )
    )
    return sorted(ticket["title"] for ticket in page["items"])


@pytest.mark.parametrize(
    "unit, missing",
    [
        ("points", ["hours only", "neither"]),
        ("hours", ["neither", "points only"]),
        ("both", ["hours only", "neither", "points only"]),
    ],
)
def test_has_no_estimate_asks_about_what_the_team_estimates_in(
    client, team, unit, missing
):
    make_ticket(client, team, "neither")
    make_ticket(client, team, "points only", estimate=3)
    hours = make_ticket(client, team, "hours only")
    patch(client, team, hours, time_estimate_minutes=2 * H)
    both = make_ticket(client, team, "both", estimate=3)
    patch(client, team, both, time_estimate_minutes=H)
    client.patch(
        f"/teams/{team['team']['id']}",
        json={"estimate_unit": unit},
        headers=team["headers"],
    )
    assert _missing_estimate(client, team) == missing


def test_the_export_gains_three_columns_in_hours(client, team):
    ticket = make_ticket(client, team)
    patch(client, team, ticket, time_estimate_minutes=10 * H)
    log(client, team, ticket, 7 * H + 30)
    make_ticket(client, team, "Unsized")

    response = client.get(
        f"/teams/{team['team']['id']}/tickets/export", headers=team["headers"]
    )
    rows = list(csv.DictReader(io.StringIO(response.text)))
    by_title = {row["title"]: row for row in rows}
    assert by_title["Magic link"]["time_estimate_hours"] == "10"
    assert by_title["Magic link"]["time_logged_hours"] == "7.5"
    assert by_title["Magic link"]["time_remaining_hours"] == "2.5"
    assert by_title["Unsized"]["time_estimate_hours"] == ""
    assert by_title["Unsized"]["time_logged_hours"] == "0"
    assert by_title["Unsized"]["time_remaining_hours"] == ""

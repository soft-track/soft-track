"""Reports reconstructed from ticket history (issue #23).

The API cannot travel in time, so tests that need a multi-day history write
event rows directly with chosen timestamps. That is the same data the
recorder writes -- see test_history.py, which covers the recorder itself.
"""

from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import select

from lib_softtrack.tables import TicketEvent, TicketEventField

DAY = timedelta(days=1)


def at(session, ticket, field, new, old=None, when=None):
    """Write one history row at a chosen moment."""
    session.add(
        TicketEvent(
            ticket_id=ticket["id"],
            team_id=ticket["team_id"],
            field=field,
            old_value=old,
            new_value=new,
            actor_id=None,
            created_at=when or datetime.now(timezone.utc),
        )
    )
    session.commit()


def make_ticket(client, team, title="Work", **fields):
    response = client.post(
        f"/teams/{team['team']['id']}/tickets",
        json={"title": title, **fields},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def make_sprint(client, team, start, days=5, name=None):
    response = client.post(
        f"/teams/{team['team']['id']}/sprints",
        json={
            "name": name,
            "starts_at": start.isoformat(),
            "ends_at": (start + timedelta(days=days)).isoformat(),
        },
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


# --- burndown -----------------------------------------------------------


def test_burndown_covers_the_sprint_and_stops_at_today(client, team, session):
    """A line running flat to the end of the sprint reads as "nothing is
    happening" rather than "this has not happened yet"."""
    start = datetime.now(timezone.utc) - 2 * DAY
    sprint = make_sprint(client, team, start, days=10)

    report = client.get(
        f"/sprints/{sprint['id']}/burndown", headers=team["headers"]
    ).json()
    assert len(report["points"]) == 3
    assert report["points"][-1]["day"] == datetime.now(timezone.utc).date().isoformat()


def test_burndown_falls_as_work_is_finished(client, team, session):
    start = datetime.now(timezone.utc) - 3 * DAY
    sprint = make_sprint(client, team, start, days=10)
    ticket = make_ticket(client, team, "Work", estimate=8, sprint_id=sprint["id"])

    # The recorder wrote the opening events at "now"; place them in the past
    # and finish the ticket yesterday.
    for event in session.exec(select(TicketEvent)).all():
        event.created_at = start
        session.add(event)
    session.commit()
    at(
        session,
        ticket,
        TicketEventField.status,
        "done",
        "backlog",
        datetime.now(timezone.utc) - DAY,
    )

    points = client.get(
        f"/sprints/{sprint['id']}/burndown", headers=team["headers"]
    ).json()["points"]
    assert points[0]["points_remaining"] == 8
    assert points[-1]["points_remaining"] == 0
    assert points[-1]["points_completed"] == 8


def test_cancelled_work_leaves_the_burndown_without_counting_as_done(
    client, team, session
):
    """It stops being outstanding, but it was not delivered."""
    start = datetime.now(timezone.utc) - 2 * DAY
    sprint = make_sprint(client, team, start, days=10)
    ticket = make_ticket(client, team, "Work", estimate=5, sprint_id=sprint["id"])
    for event in session.exec(select(TicketEvent)).all():
        event.created_at = start
        session.add(event)
    session.commit()
    at(session, ticket, TicketEventField.status, "cancelled", "backlog")

    last = client.get(
        f"/sprints/{sprint['id']}/burndown", headers=team["headers"]
    ).json()["points"][-1]
    assert last["points_remaining"] == 0
    assert last["points_completed"] == 0


def test_the_ideal_line_runs_from_opening_scope_to_zero(client, team, session):
    """From the *opening* scope, so adding work cannot quietly move the
    goalposts and leave the line always looking on track."""
    start = datetime.now(timezone.utc) - 2 * DAY
    sprint = make_sprint(client, team, start, days=4)
    ticket = make_ticket(client, team, "Work", estimate=8, sprint_id=sprint["id"])
    for event in session.exec(select(TicketEvent)).all():
        event.created_at = start
        session.add(event)
    session.commit()

    points = client.get(
        f"/sprints/{sprint['id']}/burndown", headers=team["headers"]
    ).json()["points"]
    assert points[0]["ideal_remaining"] == 8
    assert points[1]["ideal_remaining"] < points[0]["ideal_remaining"]


def test_scope_added_mid_sprint_is_reported(client, team, session):
    """A burndown that hides scope changes makes a team look slow when what
    actually happened is that the sprint grew."""
    start = datetime.now(timezone.utc) - 2 * DAY
    sprint = make_sprint(client, team, start, days=10)
    first = make_ticket(client, team, "Planned", estimate=3, sprint_id=sprint["id"])
    for event in session.exec(select(TicketEvent)).all():
        event.created_at = start
        session.add(event)
    session.commit()

    late = make_ticket(client, team, "Added later", estimate=5)
    at(session, late, TicketEventField.estimate, "5", None, start)
    at(session, late, TicketEventField.status, "backlog", None, start)
    at(
        session,
        late,
        TicketEventField.sprint,
        str(sprint["id"]),
        None,
        datetime.now(timezone.utc),
    )

    report = client.get(
        f"/sprints/{sprint['id']}/burndown", headers=team["headers"]
    ).json()
    assert report["scope_changes"], "a mid-sprint addition must be visible"
    change = report["scope_changes"][-1]
    assert change["tickets_added"] == 1
    assert change["points_added"] == 5
    assert report["points"][-1]["points_total"] == 8
    assert first["id"] != late["id"]


def test_work_removed_from_a_sprint_stops_counting_from_that_day(client, team, session):
    start = datetime.now(timezone.utc) - 2 * DAY
    sprint = make_sprint(client, team, start, days=10)
    ticket = make_ticket(client, team, "Pulled out", estimate=5, sprint_id=sprint["id"])
    for event in session.exec(select(TicketEvent)).all():
        event.created_at = start
        session.add(event)
    session.commit()
    at(session, ticket, TicketEventField.sprint, None, str(sprint["id"]))

    points = client.get(
        f"/sprints/{sprint['id']}/burndown", headers=team["headers"]
    ).json()["points"]
    assert points[0]["points_total"] == 5
    assert points[-1]["points_total"] == 0


def test_burndown_is_not_visible_across_teams(client, team, auth):
    sprint = make_sprint(client, team, datetime.now(timezone.utc))
    outsider = auth(email="outsider@softtrack.dev", full_name="Outsider")
    assert client.get(
        f"/sprints/{sprint['id']}/burndown", headers=outsider["headers"]
    ).status_code in (403, 404)


# --- velocity -----------------------------------------------------------


def test_velocity_lists_completed_sprints_only(client, team):
    start = datetime.now(timezone.utc) - 20 * DAY
    done = make_sprint(client, team, start, days=5, name="Finished")
    make_sprint(client, team, start + 10 * DAY, days=5, name="Ongoing")
    client.post(f"/sprints/{done['id']}/complete", headers=team["headers"])

    report = client.get(
        f"/teams/{team['team']['id']}/velocity", headers=team["headers"]
    ).json()
    assert [row["sprint_name"] for row in report["sprints"]] == ["Finished"]


def test_velocity_counts_delivered_points(client, team):
    start = datetime.now(timezone.utc) - 20 * DAY
    sprint = make_sprint(client, team, start, days=5)
    make_ticket(
        client,
        team,
        "A",
        estimate=5,
        sprint_id=sprint["id"],
        status_id=team["status_ids"]["Done"],
    )
    make_ticket(client, team, "B", estimate=3, sprint_id=sprint["id"])
    client.post(f"/sprints/{sprint['id']}/complete", headers=team["headers"])

    row = client.get(
        f"/teams/{team['team']['id']}/velocity", headers=team["headers"]
    ).json()["sprints"][0]
    assert row["points_completed"] == 5
    assert row["tickets_completed"] == 1


def test_velocity_average_is_null_with_no_history(client, team):
    """Zero would read as "this team delivers nothing", which is a different
    and much worse claim than "we have not run a sprint yet"."""
    report = client.get(
        f"/teams/{team['team']['id']}/velocity", headers=team["headers"]
    ).json()
    assert report["sprints"] == []
    assert report["average_points"] is None


# --- cumulative flow ----------------------------------------------------


def test_cumulative_flow_counts_each_status_per_day(client, team, session):
    ticket = make_ticket(client, team, "Work")
    for event in session.exec(select(TicketEvent)).all():
        event.created_at = datetime.now(timezone.utc) - 3 * DAY
        session.add(event)
    session.commit()
    # The history stores categories, so this is what a move into any column
    # the team calls "started" looks like.
    at(
        session,
        ticket,
        TicketEventField.status,
        "started",
        "backlog",
        datetime.now(timezone.utc) - DAY,
    )

    days = client.get(
        f"/teams/{team['team']['id']}/cumulative-flow",
        params={"days": 4},
        headers=team["headers"],
    ).json()["days"]
    assert days[0]["counts"]["backlog"] == 1
    assert days[-1]["counts"]["started"] == 1
    assert days[-1]["counts"]["backlog"] == 0


def test_a_ticket_is_not_counted_before_it_existed(client, team):
    """Counting it in backlog would draw work that had not been created."""
    make_ticket(client, team, "Created today")
    days = client.get(
        f"/teams/{team['team']['id']}/cumulative-flow",
        params={"days": 5},
        headers=team["headers"],
    ).json()["days"]
    assert sum(days[0]["counts"].values()) == 0
    assert sum(days[-1]["counts"].values()) == 1


def test_every_status_appears_even_when_empty(client, team):
    make_ticket(client, team, "Work")
    counts = client.get(
        f"/teams/{team['team']['id']}/cumulative-flow",
        params={"days": 1},
        headers=team["headers"],
    ).json()["days"][0]["counts"]
    # The five fixed categories, not the team's columns: a chart of the past
    # has to keep meaning something after the board is rearranged.
    assert set(counts) == {
        "backlog",
        "unstarted",
        "started",
        "done",
        "cancelled",
    }


# --- created vs resolved ------------------------------------------------


def test_created_and_resolved_are_counted_per_day(client, team, session):
    ticket = make_ticket(client, team, "Work")
    at(session, ticket, TicketEventField.status, "done", "backlog")

    report = client.get(
        f"/teams/{team['team']['id']}/created-vs-resolved",
        params={"days": 3},
        headers=team["headers"],
    ).json()
    assert report["total_created"] == 1
    assert report["total_resolved"] == 1
    assert report["days"][-1]["open_at_end_of_day"] == 0


def test_reopening_does_not_count_as_a_second_resolution(client, team, session):
    ticket = make_ticket(client, team, "Work")
    at(session, ticket, TicketEventField.status, "done", "backlog")
    at(session, ticket, TicketEventField.status, "todo", "done")
    at(session, ticket, TicketEventField.status, "done", "todo")

    report = client.get(
        f"/teams/{team['team']['id']}/created-vs-resolved",
        params={"days": 3},
        headers=team["headers"],
    ).json()
    assert report["total_resolved"] == 2, "each open->closed transition counts once"


def test_the_backlog_line_starts_where_the_backlog_actually_was(client, team, session):
    """Tickets created before the window still count as open, or the line
    starts at zero and the chart lies about the backlog."""
    old = make_ticket(client, team, "Old")
    for event in session.exec(select(TicketEvent)).all():
        event.created_at = datetime.now(timezone.utc) - 30 * DAY
        session.add(event)
    from lib_softtrack.tables import Ticket

    row = session.get(Ticket, old["id"])
    row.created_at = datetime.now(timezone.utc) - 30 * DAY
    session.add(row)
    session.commit()

    report = client.get(
        f"/teams/{team['team']['id']}/created-vs-resolved",
        params={"days": 3},
        headers=team["headers"],
    ).json()
    assert report["total_created"] == 0
    assert report["days"][0]["open_at_end_of_day"] == 1


@pytest.mark.parametrize("path", ["velocity", "cumulative-flow", "created-vs-resolved"])
def test_reports_are_not_visible_across_teams(client, team, auth, path):
    outsider = auth(email="outsider@softtrack.dev", full_name="Outsider")
    assert client.get(
        f"/teams/{team['team']['id']}/{path}", headers=outsider["headers"]
    ).status_code in (403, 404)

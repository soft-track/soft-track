"""Recurring tickets (#264): work that comes back on a schedule.

The sweep is driven directly with a `now`, the way the reminders' tests drive
theirs. A schedule counts from the day it is made -- the real today -- so the
mornings asked about are today's and later ones; the calendar arithmetic is
tested on its own, on rows that are never saved.
"""

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlmodel import select

from lib_softtrack.schedules import (
    create_scheduled_tickets,
    due_occurrence,
    next_occurrence,
    occurs_on,
)
from lib_softtrack.tables import (
    ScheduleRun,
    Team,
    Ticket,
    TicketSchedule,
    User,
    utcnow,
)

from tests.test_notifications import inbox

TODAY = datetime.now(timezone.utc).date()


def at(day: date, hour: int = 8, minute: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=timezone.utc)


def days(n: int) -> timedelta:
    return timedelta(days=n)


def every_day(**fields) -> dict:
    return {"title": "Check the backups", "frequency": "daily", **fields}


@pytest.fixture
def pair(client, team, auth):
    member = auth(email="member@softtrack.dev", full_name="Daniel Okafor")
    response = client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": "member@softtrack.dev"},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return {**team, "member": member}


def add(client, actor, team_id, body, status=200):
    response = client.post(
        f"/teams/{team_id}/ticket-schedules", json=body, headers=actor["headers"]
    )
    assert response.status_code == status, response.text
    return response.json()


def listed(client, actor, team_id):
    response = client.get(
        f"/teams/{team_id}/ticket-schedules", headers=actor["headers"]
    )
    assert response.status_code == 200, response.text
    return response.json()


def change(client, actor, schedule, body, status=200):
    response = client.patch(
        f"/ticket-schedules/{schedule['id']}", json=body, headers=actor["headers"]
    )
    assert response.status_code == status, response.text
    return response.json()


def starting(session, made, day):
    """Count a schedule's occurrences from `day` rather than from today."""
    row = session.get(TicketSchedule, made["id"])
    row.active_since = day
    session.add(row)
    session.commit()


def team_tickets(session, team_id):
    session.expire_all()
    return session.exec(
        select(Ticket).where(Ticket.team_id == team_id).order_by(Ticket.id)
    ).all()


# --- the calendar --------------------------------------------------------------


def schedule(**fields) -> TicketSchedule:
    """A schedule that is never saved, for the arithmetic."""
    defaults = {
        "team_id": 1,
        "title": "x",
        "created_by_id": 1,
        "starts_on": date(2026, 9, 2),  # a Wednesday
        "active_since": date(2026, 9, 2),
    }
    return TicketSchedule(**{**defaults, **fields})


def on(rule: TicketSchedule, start: date, end: date) -> list[date]:
    out, day = [], start
    while day <= end:
        if occurs_on(rule, day):
            out.append(day)
        day += days(1)
    return out


def test_every_monday():
    rule = schedule(frequency="weekly", weekdays=[0])
    assert on(rule, date(2026, 9, 1), date(2026, 9, 30)) == [
        date(2026, 9, 7),
        date(2026, 9, 14),
        date(2026, 9, 21),
        date(2026, 9, 28),
    ]


def test_every_other_week_counts_from_the_week_it_started():
    rule = schedule(frequency="weekly", weekdays=[0, 3], interval=2)
    # Started in the week of Monday 31 August: that week, then a fortnight on.
    assert on(rule, date(2026, 8, 31), date(2026, 9, 27)) == [
        date(2026, 8, 31),
        date(2026, 9, 3),
        date(2026, 9, 14),
        date(2026, 9, 17),
    ]


def test_the_31st_of_a_short_month_is_its_last_day():
    rule = schedule(frequency="monthly", month_day="date", day_of_month=31)
    assert on(rule, date(2027, 1, 1), date(2027, 4, 30)) == [
        date(2027, 1, 31),
        date(2027, 2, 28),
        date(2027, 3, 31),
        date(2027, 4, 30),
    ]


def test_first_and_last_working_days():
    first = schedule(frequency="monthly", month_day="first_working_day")
    last = schedule(frequency="monthly", month_day="last_working_day")
    # August 2026 starts on a Saturday and ends on a Monday.
    assert on(first, date(2026, 8, 1), date(2026, 8, 31)) == [date(2026, 8, 3)]
    assert on(last, date(2026, 8, 1), date(2026, 8, 31)) == [date(2026, 8, 31)]
    # October 2026 ends on a Saturday.
    assert on(last, date(2026, 10, 1), date(2026, 10, 31)) == [date(2026, 10, 30)]


def test_every_quarter_is_january_april_july_and_october():
    rule = schedule(frequency="quarterly", month_day="first_working_day")
    assert on(rule, date(2026, 1, 1), date(2026, 12, 31)) == [
        date(2026, 1, 1),
        date(2026, 4, 1),
        date(2026, 7, 1),
        date(2026, 10, 1),
    ]


def test_every_year_in_its_month():
    rule = schedule(frequency="yearly", month_day="date", day_of_month=15, month=3)
    assert on(rule, date(2026, 1, 1), date(2027, 12, 31)) == [
        date(2026, 3, 15),
        date(2027, 3, 15),
    ]


def test_a_gap_is_one_occurrence_the_latest():
    rule = schedule(frequency="weekly", weekdays=[0])
    # The loop was down for a fortnight; it makes the latest Monday, once.
    assert due_occurrence(rule, date(2026, 9, 23), None) == date(2026, 9, 21)
    assert due_occurrence(rule, date(2026, 9, 23), date(2026, 9, 21)) is None
    assert next_occurrence(rule, date(2026, 9, 23), date(2026, 9, 21)) == date(
        2026, 9, 28
    )
    # Nothing before the day it was switched on.
    assert due_occurrence(rule, date(2026, 9, 6), None) is None


# --- writing one ---------------------------------------------------------------


def test_an_admin_adds_one_and_every_member_can_read_it(client, pair):
    team_id = pair["team"]["id"]
    made = add(
        client,
        pair,
        team_id,
        {
            "title": "Dependency updates",
            "frequency": "weekly",
            "weekdays": [0],
            "assignee_id": pair["member"]["user"]["id"],
            "into_active_sprint": True,
            # Not for this frequency: cleared rather than kept.
            "day_of_month": 4,
        },
    )
    assert made["assignee"]["full_name"] == "Daniel Okafor"
    assert made["day_of_month"] is None
    assert made["created_count"] == 0
    assert made["next_on"] is not None
    assert occurs_on(
        schedule(frequency="weekly", weekdays=[0]), date.fromisoformat(made["next_on"])
    )

    assert [s["title"] for s in listed(client, pair["member"], team_id)] == [
        "Dependency updates"
    ]
    refused = client.post(
        f"/teams/{team_id}/ticket-schedules",
        json=every_day(),
        headers=pair["member"]["headers"],
    )
    assert refused.status_code == 403
    assert refused.json()["code"] == "not_team_admin"


@pytest.mark.parametrize(
    "body",
    [
        {"title": "x", "frequency": "weekly"},
        {"title": "x", "frequency": "monthly"},
        {"title": "x", "frequency": "monthly", "month_day": "date"},
        {"title": "x", "frequency": "yearly", "month_day": "last_working_day"},
        {"title": "x", "frequency": "weekly", "weekdays": [7]},
        {"title": "  ", "frequency": "daily"},
        {"title": "x", "frequency": "hourly"},
    ],
)
def test_a_schedule_that_does_not_say_when_is_refused(client, team, body):
    add(client, team, team["team"]["id"], body, status=422)


def test_it_names_only_what_is_on_its_team(client, team, auth):
    team_id = team["team"]["id"]
    stranger = auth(email="stranger@softtrack.dev")
    response = add(
        client,
        team,
        team_id,
        every_day(assignee_id=stranger["user"]["id"]),
        status=400,
    )
    assert response["code"] == "user_not_on_team"

    other = client.post(
        "/teams", json={"name": "Ops", "key": "OPS"}, headers=team["headers"]
    ).json()
    label = client.post(
        f"/teams/{other['id']}/labels", json={"name": "ops"}, headers=team["headers"]
    ).json()
    response = add(client, team, team_id, every_day(label_ids=[label["id"]]), 400)
    assert response["code"] == "not_on_this_team"


def test_pause_resume_and_remove(client, team, session):
    team_id = team["team"]["id"]
    made = add(client, team, team_id, every_day())

    paused = change(client, team, made, {"paused": True})
    assert paused["paused_by"]["id"] == team["user"]["id"]
    assert paused["paused_at"] is not None
    assert paused["next_on"] is None
    assert create_scheduled_tickets(session, at(TODAY + days(3))) == 0

    # Back on, it does not make up for the days it was off.
    resumed = change(client, team, made, {"paused": False})
    assert resumed["paused_at"] is None
    assert create_scheduled_tickets(session, at(TODAY + days(3))) == 1
    assert len(team_tickets(session, team_id)) == 1

    edited = change(
        client,
        team,
        made,
        {"schedule": every_day(title="Check the restores", priority="high")},
    )
    assert edited["title"] == "Check the restores"
    assert edited["created_count"] == 1

    response = client.delete(f"/ticket-schedules/{made['id']}", headers=team["headers"])
    assert response.status_code == 204, response.text
    assert listed(client, team, team_id) == []
    # The ticket it made stays.
    assert len(team_tickets(session, team_id)) == 1


def test_an_account_from_outside_does_not_read_them(client, team, auth, session):
    outsider = auth(email="client@example.com")
    user = session.get(User, outsider["user"]["id"])
    user.is_external = True
    session.add(user)
    session.commit()
    response = client.get(
        f"/teams/{team['team']['id']}/ticket-schedules", headers=outsider["headers"]
    )
    assert response.status_code == 403
    assert response.json()["code"] == "external_account"


# --- what it creates -------------------------------------------------------------


def test_it_creates_the_ticket_it_says_at_eight(client, pair, session):
    team_id = pair["team"]["id"]
    h = pair["headers"]
    label = client.post(
        f"/teams/{team_id}/labels", json={"name": "chore"}, headers=h
    ).json()
    epic = client.post(
        f"/teams/{team_id}/projects", json={"name": "Upkeep"}, headers=h
    ).json()
    made = add(
        client,
        pair,
        team_id,
        every_day(
            title="Dependency updates",
            description="Run `npm outdated`.",
            type="story",
            priority="medium",
            assignee_id=pair["member"]["user"]["id"],
            label_ids=[label["id"]],
            project_id=epic["id"],
            estimate=3,
            due_after_days=2,
        ),
    )
    day = TODAY + days(1)
    starting(session, made, day)

    assert create_scheduled_tickets(session, at(day, 7, 59)) == 0
    assert create_scheduled_tickets(session, at(day, 8)) == 1
    # Every tick of the rest of the day finds it made.
    assert create_scheduled_tickets(session, at(day, 8, 5)) == 0
    assert create_scheduled_tickets(session, at(day, 23)) == 0

    [ticket] = team_tickets(session, team_id)
    read = client.get(f"/tickets/{ticket.id}", headers=h).json()
    assert read["title"] == "Dependency updates"
    assert read["description"] == "Run `npm outdated`."
    assert read["type"] == "story"
    assert read["priority"] == "medium"
    assert read["assignee"]["id"] == pair["member"]["user"]["id"]
    assert [row["id"] for row in read["labels"]] == [label["id"]]
    assert read["project_id"] == epic["id"]
    assert read["estimate"] == 3
    # Counted from the day it was created, in the backlog with no sprint.
    assert read["due_date"] == (day + days(2)).isoformat()
    assert read["sprint_id"] is None
    assert read["identifier"] == "ENG-1"

    # The history says which schedule created it, and nobody did.
    events = client.get(f"/tickets/{ticket.id}/events", headers=h).json()
    assert [(e["field"], e["new_value"], e["actor"]) for e in events] == [
        ("schedule", "Dependency updates", None)
    ]
    # Its assignee is told, by nobody; the admin who wrote the schedule is
    # its creator and does not watch it for that.
    [note] = [n for n in inbox(client, pair["member"]) if n["kind"] == "assigned"]
    assert note["actor"] is None
    assert inbox(client, pair) == []

    # And the schedule lists it.
    [row] = listed(client, pair, team_id)
    assert row["created_count"] == 1
    assert row["recent_tickets"] == [
        {"id": ticket.id, "identifier": "ENG-1", "title": "Dependency updates"}
    ]
    assert made["id"] == row["id"]


def test_it_lands_in_the_active_sprint_when_there_is_one(client, team, session):
    team_id = team["team"]["id"]
    add(client, team, team_id, every_day(into_active_sprint=True))
    sprint = client.post(
        f"/teams/{team_id}/sprints",
        json={
            "starts_at": TODAY.isoformat(),
            "ends_at": (TODAY + days(14)).isoformat(),
        },
        headers=team["headers"],
    ).json()

    # None started: the backlog.
    assert create_scheduled_tickets(session, at(TODAY + days(1))) == 1
    started = client.post(f"/sprints/{sprint['id']}/start", headers=team["headers"])
    assert started.status_code == 200, started.text
    assert create_scheduled_tickets(session, at(TODAY + days(2))) == 1

    assert [t.sprint_id for t in team_tickets(session, team_id)] == [
        None,
        sprint["id"],
    ]


def test_rules_and_numbering_treat_it_as_any_other_ticket(client, team, session):
    team_id = team["team"]["id"]
    response = client.post(
        f"/teams/{team_id}/automation-rules",
        json={
            "name": "Urgent",
            "trigger": "ticket_created",
            "actions": {"set_priority": "urgent"},
        },
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    client.post(
        f"/teams/{team_id}/tickets", json={"title": "By hand"}, headers=team["headers"]
    )
    add(client, team, team_id, every_day())

    assert create_scheduled_tickets(session, at(TODAY + days(1))) == 1
    tickets = team_tickets(session, team_id)
    assert [(t.number, t.priority.value) for t in tickets] == [
        (1, "urgent"),
        (2, "urgent"),
    ]


def test_each_occurrence_is_created_once_however_many_workers(client, team, session):
    """Another worker claimed the morning first: its claim is the row, and
    this sweep finds the key taken."""
    team_id = team["team"]["id"]
    made = add(client, team, team_id, every_day())
    day = TODAY + days(1)
    session.add(ScheduleRun(schedule_id=made["id"], occurs_on=day))
    session.commit()

    assert create_scheduled_tickets(session, at(day)) == 0
    assert team_tickets(session, team_id) == []


def test_a_gap_makes_one_ticket(client, team, session):
    team_id = team["team"]["id"]
    add(client, team, team_id, every_day())
    assert create_scheduled_tickets(session, at(TODAY + days(5))) == 1
    assert len(team_tickets(session, team_id)) == 1


# --- when it stops, and when it adapts ------------------------------------------


def test_nothing_on_an_archived_team(client, team, session):
    team_id = team["team"]["id"]
    add(client, team, team_id, every_day())
    row = session.get(Team, team_id)
    row.archived_at = utcnow()
    session.add(row)
    session.commit()

    assert create_scheduled_tickets(session, at(TODAY + days(1))) == 0


@pytest.mark.parametrize("how", ["left", "deactivated"])
def test_an_assignee_who_is_gone_gets_an_unassigned_ticket(client, pair, session, how):
    team_id = pair["team"]["id"]
    member_id = pair["member"]["user"]["id"]
    add(client, pair, team_id, every_day(assignee_id=member_id))
    if how == "left":
        response = client.delete(
            f"/teams/{team_id}/members/{member_id}", headers=pair["headers"]
        )
        assert response.status_code in (200, 204), response.text
    else:
        user = session.get(User, member_id)
        user.is_active = False
        session.add(user)
        session.commit()

    assert create_scheduled_tickets(session, at(TODAY + days(1))) == 1
    [ticket] = team_tickets(session, team_id)
    assert ticket.assignee_id is None
    # The schedule still says who it is for.
    [row] = listed(client, pair, team_id)
    assert row["assignee_id"] == member_id


def test_only_once_the_previous_one_is_done(client, team, session):
    team_id = team["team"]["id"]
    add(client, team, team_id, every_day(wait_for_previous=True))
    assert create_scheduled_tickets(session, at(TODAY + days(1))) == 1
    [first] = team_tickets(session, team_id)

    # Still open: nothing, however many days go by, and the list says why.
    assert create_scheduled_tickets(session, at(TODAY + days(2))) == 0
    assert create_scheduled_tickets(session, at(TODAY + days(3))) == 0
    [row] = listed(client, team, team_id)
    assert row["waiting_on"]["identifier"] == "ENG-1"

    response = client.patch(
        f"/tickets/{first.id}",
        json={"status_id": team["status_ids"]["Done"]},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    # Done: the next one, once, for the latest day.
    assert create_scheduled_tickets(session, at(TODAY + days(3), 9)) == 1
    assert create_scheduled_tickets(session, at(TODAY + days(3), 10)) == 0
    assert len(team_tickets(session, team_id)) == 2
    assert listed(client, team, team_id)[0]["waiting_on"]["identifier"] == "ENG-2"


def test_a_previous_one_in_the_trash_does_not_hold_it_up(client, team, session):
    team_id = team["team"]["id"]
    add(client, team, team_id, every_day(wait_for_previous=True))
    assert create_scheduled_tickets(session, at(TODAY + days(1))) == 1
    [first] = team_tickets(session, team_id)
    response = client.delete(f"/tickets/{first.id}", headers=team["headers"])
    assert response.status_code == 204, response.text

    assert create_scheduled_tickets(session, at(TODAY + days(2))) == 1


def test_a_purged_ticket_is_not_made_again(client, team, session):
    team_id = team["team"]["id"]
    made = add(client, team, team_id, every_day())
    day = TODAY + days(1)
    assert create_scheduled_tickets(session, at(day)) == 1
    [ticket] = team_tickets(session, team_id)

    client.delete(f"/tickets/{ticket.id}", headers=team["headers"])
    purged = client.delete(f"/trash/tickets/{ticket.id}", headers=team["headers"])
    assert purged.status_code == 204, purged.text

    session.expire_all()
    run = session.get(ScheduleRun, (made["id"], day))
    assert run is not None and run.ticket_id is None
    assert create_scheduled_tickets(session, at(day, 12)) == 0
    assert listed(client, team, team_id)[0]["created_count"] == 0


def test_an_epic_purged_from_the_trash_leaves_it(client, team, session):
    team_id = team["team"]["id"]
    epic = client.post(
        f"/teams/{team_id}/projects", json={"name": "Upkeep"}, headers=team["headers"]
    ).json()
    made = add(client, team, team_id, every_day(project_id=epic["id"]))

    client.delete(f"/projects/{epic['id']}", headers=team["headers"])
    # In the trash: its ticket is filed into no epic.
    assert create_scheduled_tickets(session, at(TODAY + days(1))) == 1
    assert team_tickets(session, team_id)[0].project_id is None

    purged = client.delete(f"/trash/projects/{epic['id']}", headers=team["headers"])
    assert purged.status_code == 204, purged.text
    session.expire_all()
    assert session.get(TicketSchedule, made["id"]).project_id is None

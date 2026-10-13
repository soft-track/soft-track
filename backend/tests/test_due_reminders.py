"""Due-date reminders (#262): before a ticket is late, and when it is.

The sweep is driven directly with a `now`, the way the digest's tests drive
the digest. Due dates are put a few days ahead of the real today, so the
ticket was created, and last changed, before every morning the tests ask
about -- which is what "nothing has changed since" compares against.
"""

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlmodel import select

from lib_softtrack.digest import render_digest
from lib_softtrack.notifications import expand_notifications
from lib_softtrack.reminders import Stage, reminder_day, send_due_reminders
from lib_softtrack.tables import (
    DueReminder,
    Notification,
    NotificationKind,
    Team,
    Ticket,
    User,
    utcnow,
)

from tests.test_digest import _item
from tests.test_notifications import inbox, make_ticket, set_watching

DUE = datetime.now(timezone.utc).date() + timedelta(days=5)


def at(day: date, hour: int = 8, minute: int = 0) -> datetime:
    """A moment on `day`, in UTC -- the instance's timezone by default."""
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=timezone.utc)


def days(n: int) -> timedelta:
    return timedelta(days=n)


@pytest.fixture
def pair(client, team, auth):
    member = auth(email="member@softtrack.dev", full_name="Plain Member")
    response = client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": "member@softtrack.dev"},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return {**team, "member": member}


@pytest.fixture
def assigned(client, pair):
    """A ticket of the member's, due on DUE, filed by the admin."""
    ticket = make_ticket(
        client,
        pair,
        pair["team"],
        title="Regression pass",
        assignee_id=pair["member"]["user"]["id"],
        due_date=DUE.isoformat(),
    )
    return {**pair, "ticket": ticket}


def reminders(client, actor):
    return [
        (row["kind"], row["due_date"])
        for row in inbox(client, actor)
        if row["kind"] in ("due_tomorrow", "overdue")
    ]


def patch(client, actor, ticket, **body):
    response = client.patch(
        f"/tickets/{ticket['id']}", json=body, headers=actor["headers"]
    )
    assert response.status_code == 200, response.text


# --- when each one goes out --------------------------------------------------


def test_due_tomorrow_goes_to_the_assignee_on_the_morning_before(
    client, assigned, session
):
    member = assigned["member"]
    assert send_due_reminders(session, at(DUE - days(1), 7, 59)) == 0
    assert send_due_reminders(session, at(DUE - days(1), 8)) == 1

    assert reminders(client, member) == [("due_tomorrow", DUE.isoformat())]
    # The admin filed it and watches it, but it is the member's to do.
    assert reminders(client, assigned) == []

    row = inbox(client, member)[0]
    assert row["actor"] is None
    assert row["assigned_to_you"] is True


def test_nothing_on_the_due_date_itself(client, assigned, session):
    """Too late for "tomorrow", too early for "overdue"."""
    assert send_due_reminders(session, at(DUE, 9)) == 0
    assert reminders(client, assigned["member"]) == []


def test_overdue_the_day_after_and_once_more_a_week_later(client, assigned, session):
    member = assigned["member"]
    assert send_due_reminders(session, at(DUE + days(1), 8)) == 1
    # Every tick of the rest of that week finds it already sent.
    for n in range(1, 8):
        assert send_due_reminders(session, at(DUE + days(n), 12)) == 0
    assert send_due_reminders(session, at(DUE + days(8), 8)) == 1
    # And that is the last of them.
    assert send_due_reminders(session, at(DUE + days(30), 8)) == 0

    assert reminders(client, member) == [("overdue", DUE.isoformat())] * 2


def test_a_week_later_only_if_nothing_has_changed(client, assigned, session):
    send_due_reminders(session, at(DUE + days(1), 8))
    ticket = session.get(Ticket, assigned["ticket"]["id"])
    ticket.updated_at = at(DUE + days(3))
    session.add(ticket)
    session.commit()

    assert send_due_reminders(session, at(DUE + days(8), 8)) == 0
    assert reminders(client, assigned["member"]) == [("overdue", DUE.isoformat())]


def test_a_downed_loop_catches_up_but_an_old_date_starts_nothing(
    client, assigned, session
):
    """A weekend without the loop still reminds on Monday; a ticket that was
    late long before the feature existed does not start reminding."""
    assert send_due_reminders(session, at(DUE + days(4), 10)) == 1

    old = make_ticket(
        client,
        assigned,
        assigned["team"],
        assignee_id=assigned["member"]["user"]["id"],
        due_date=(DUE - days(60)).isoformat(),
    )
    assert send_due_reminders(session, at(DUE + days(4), 11)) == 0
    assert all(row["ticket"]["id"] != old["id"] for row in inbox(client, assigned))


def test_the_morning_is_the_instance_timezone(client, assigned, session, monkeypatch):
    """A due date is a date: Karachi's morning before it is 03:00 in UTC."""
    from web import settings

    monkeypatch.setattr(settings, "default_timezone", "Asia/Karachi")
    assert send_due_reminders(session, at(DUE - days(1), 2, 59)) == 0
    assert send_due_reminders(session, at(DUE - days(1), 3)) == 1


def test_the_reminder_day_turns_over_at_eight():
    from zoneinfo import ZoneInfo

    utc = ZoneInfo("UTC")
    assert reminder_day(at(DUE, 7, 59), utc) == DUE - days(1)
    assert reminder_day(at(DUE, 8), utc) == DUE


# --- once, and starting over ---------------------------------------------------


def test_moving_the_due_date_starts_over(client, assigned, session):
    send_due_reminders(session, at(DUE - days(1), 8))
    later = DUE + days(2)
    patch(client, assigned, assigned["ticket"], due_date=later.isoformat())

    assert send_due_reminders(session, at(later - days(1), 8)) == 1
    assert reminders(client, assigned["member"]) == [
        ("due_tomorrow", later.isoformat()),
        ("due_tomorrow", DUE.isoformat()),
    ]


def test_a_reminder_already_claimed_is_not_sent_twice(client, assigned, session):
    """Another worker got there first: its claim is the row, and this sweep
    finds the key taken."""
    session.add(
        DueReminder(
            ticket_id=assigned["ticket"]["id"],
            user_id=assigned["member"]["user"]["id"],
            due_date=DUE,
            stage=Stage.due_tomorrow.value,
        )
    )
    session.commit()

    assert send_due_reminders(session, at(DUE - days(1), 8)) == 0
    assert reminders(client, assigned["member"]) == []


# --- when nothing is sent ------------------------------------------------------


@pytest.mark.parametrize("status", ["Done", "Cancelled"])
def test_a_finished_ticket_never_reminds(client, assigned, session, status):
    status_id = assigned["status_ids"][status]
    patch(client, assigned, assigned["ticket"], status_id=status_id)

    for n in (-1, 1, 8):
        assert send_due_reminders(session, at(DUE + days(n), 8)) == 0


def test_a_ticket_in_the_trash_never_reminds(client, assigned, session):
    response = client.delete(
        f"/tickets/{assigned['ticket']['id']}", headers=assigned["headers"]
    )
    assert response.status_code == 204, response.text
    assert send_due_reminders(session, at(DUE - days(1), 8)) == 0


def test_a_ticket_on_an_archived_team_never_reminds(client, assigned, session):
    team = session.get(Team, assigned["team"]["id"])
    team.archived_at = utcnow()
    session.add(team)
    session.commit()
    assert send_due_reminders(session, at(DUE - days(1), 8)) == 0


def test_a_deactivated_assignee_is_not_reminded(client, assigned, session):
    user = session.get(User, assigned["member"]["user"]["id"])
    user.is_active = False
    session.add(user)
    session.commit()
    assert send_due_reminders(session, at(DUE - days(1), 8)) == 0


def test_an_unassigned_ticket_reminds_its_watchers(client, pair, session):
    ticket = make_ticket(client, pair, pair["team"], due_date=DUE.isoformat())
    set_watching(client, pair["member"], ticket, True)

    assert send_due_reminders(session, at(DUE - days(1), 8)) == 2
    for actor in (pair, pair["member"]):
        assert reminders(client, actor) == [("due_tomorrow", DUE.isoformat())]
        assert inbox(client, actor)[0]["assigned_to_you"] is False


def test_a_kind_switched_off_is_respected(client, assigned, session):
    response = client.patch(
        "/notifications/settings",
        json={
            "preferences": [
                {"kind": "due_tomorrow", "channel": "app", "enabled": False}
            ]
        },
        headers=assigned["member"]["headers"],
    )
    assert response.status_code == 200, response.text

    send_due_reminders(session, at(DUE - days(1), 8))
    assert reminders(client, assigned["member"]) == []
    # Overdue has its own switch, still on.
    send_due_reminders(session, at(DUE + days(1), 8))
    assert reminders(client, assigned["member"]) == [("overdue", DUE.isoformat())]


def test_a_purged_ticket_takes_its_reminders_with_it(client, assigned, session):
    send_due_reminders(session, at(DUE - days(1), 8))
    ticket_id = assigned["ticket"]["id"]
    client.delete(f"/tickets/{ticket_id}", headers=assigned["headers"])
    response = client.delete(f"/trash/tickets/{ticket_id}", headers=assigned["headers"])
    assert response.status_code == 204, response.text
    assert session.exec(select(DueReminder)).all() == []


# --- in the email digest -------------------------------------------------------


def test_the_digest_lists_reminders_under_their_own_heading():
    due = _item("due_tomorrow", actor=None, identifier="ENG-12", number=12)
    late = _item("overdue", actor=None, identifier="ENG-11", number=11)
    late.due_date = date(2026, 9, 29)
    comment = _item("commented", identifier="ENG-9", number=9)

    subject, body = render_digest([due, late, comment], "https://t.example")

    assert subject == "SoftTrack: 2 reminders and 1 comment"
    assert body.index("REMINDERS") < body.index("ON TICKETS YOU WATCH")
    assert "* ENG-12 The bug · due tomorrow" in body
    assert "* ENG-11 The bug · overdue since 29 Sep" in body
    assert "* Sam Rivera commented on ENG-9" in body


def test_one_reminder_names_itself_in_the_subject():
    subject, _ = render_digest([_item("due_tomorrow", actor=None)], "https://t")
    assert subject == "SoftTrack: ENG-1 is due tomorrow"


def test_a_reminder_rides_the_digest(client, assigned, session):
    send_due_reminders(session, at(DUE - days(1), 8))
    rows = session.exec(
        select(Notification).where(Notification.kind == NotificationKind.due_tomorrow)
    ).all()
    assert [row.by_email for row in rows] == [True]
    items = expand_notifications(session, list(rows))
    assert items[0].due_date == DUE

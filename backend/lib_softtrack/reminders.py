"""Due-date reminders (#262): before a ticket is late, and when it is.

Every other notification is something a person did. These two come from a
date, so nothing calls a hook for them: a loop in the API process sweeps the
open tickets with a due date near enough to matter, and raises what is due.

* **Due tomorrow**, the day before.
* **Overdue**, the day after the date passes -- and once more a week later,
  if nothing has changed on the ticket since the first one.

To the assignee, or to the watchers of a ticket nobody is assigned. Never for
a ticket that is done or cancelled, in the trash (the ORM leaves it out, see
trash.py), or on an archived team; never to a deactivated account, somebody
no longer on the team, or somebody from outside who cannot see the ticket --
`notifications._raise` decides those, and the person's own switches and
muted teams (#263), as it does for every notification.

**A due date is a date, not a moment.** A reminder goes out at
`REMINDER_HOUR` in the recipient's morning, so "the day before" is their day
before. Their timezone is the instance's (`DEFAULT_TIMEZONE`) until a profile
has one (#252); `_zone` is the one place that changes.

**Once per ticket per date.** Each reminder is claimed by inserting a
`DueReminder` row before the notification is raised, and the row's key is
ticket, person, date and stage. Two workers -- or a restart in the middle of a
morning -- both reaching the same reminder insert the same key, and only one
insert takes. Moving the due date is a new key, so the reminders start over.
"""

import asyncio
import enum
import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlmodel import Session, select

from lib_softtrack import notifications
from lib_softtrack.statuses import RESOLVED, in_category
from lib_softtrack.tables import (
    DueReminder,
    NotificationKind,
    Team,
    Ticket,
    User,
)

logger = logging.getLogger(__name__)

#: The hour of the recipient's morning a reminder goes out at.
REMINDER_HOUR = 8
#: How long after the first overdue reminder the second one waits.
STILL_OVERDUE_AFTER = timedelta(days=7)
#: How late a reminder may still go out, counted from the morning it was due:
#: a loop that was down over a weekend catches up on Monday, but a ticket
#: that has been late for a year does not start reminding the day this
#: feature is deployed. Due tomorrow has no slack: on the due date itself it
#: would be wrong.
CATCH_UP = timedelta(days=6)


class Stage(str, enum.Enum):
    """Which of the three reminders a `DueReminder` row claimed."""

    due_tomorrow = "due_tomorrow"
    overdue = "overdue"
    still_overdue = "still_overdue"


KIND = {
    Stage.due_tomorrow: NotificationKind.due_tomorrow,
    Stage.overdue: NotificationKind.overdue,
    Stage.still_overdue: NotificationKind.overdue,
}


def _zone(user: User) -> ZoneInfo:
    """The recipient's timezone. The instance's, until #252 adds one to the
    profile -- at which point it is `user.timezone or` the line below."""
    from web import settings

    return ZoneInfo(settings.default_timezone)


def reminder_day(now: datetime, zone: ZoneInfo) -> date:
    """The latest day whose reminders are due in this zone at `now`.

    Today once it is past `REMINDER_HOUR` there, yesterday before that. The
    day before a due date is the day "due tomorrow" goes out.
    """
    local = now.astimezone(zone)
    if local.time() < time(REMINDER_HOUR):
        return local.date() - timedelta(days=1)
    return local.date()


def _stage(day: date, due: date) -> Optional[Stage]:
    """Which reminder `day` could be for, for a ticket due on `due`. The one a
    week later is only a candidate here; `_still_overdue` decides it."""
    if day == due - timedelta(days=1):
        return Stage.due_tomorrow
    first = due + timedelta(days=1)
    if first <= day <= first + CATCH_UP:
        return Stage.overdue
    if day > first + CATCH_UP:
        return Stage.still_overdue
    return None


def _aware(value: datetime) -> datetime:
    """SQLite hands datetimes back naive; they were written in UTC."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _claim(session: Session, row: DueReminder) -> bool:
    """Insert the claim unless it is already there, and say whether it took.

    The database decides, not a read before the write: two workers can both
    read "not sent yet", and only one of them can insert the key.
    """
    insert = (
        pg_insert if session.get_bind().dialect.name == "postgresql" else sqlite_insert
    )
    result = session.exec(
        insert(DueReminder)
        .values(
            ticket_id=row.ticket_id,
            user_id=row.user_id,
            due_date=row.due_date,
            stage=row.stage,
            claimed_at=row.claimed_at,
        )
        .on_conflict_do_nothing()
        # RETURNING rather than `rowcount`, which psycopg reports as -1 here.
        .returning(DueReminder.ticket_id)
    )
    return result.first() is not None


def _still_overdue(
    session: Session, ticket: Ticket, user_id: int, day: date, zone: ZoneInfo
) -> bool:
    """Whether the second overdue reminder is due on `day`: the first went to
    this person a week or more ago, and nothing on the ticket has changed
    since. A ticket somebody touched is one they are dealing with, and the
    second reminder is for the one nobody is."""
    first = session.get(
        DueReminder, (ticket.id, user_id, ticket.due_date, Stage.overdue.value)
    )
    if first is None:
        return False
    sent_on = reminder_day(_aware(first.claimed_at), zone)
    if (
        not sent_on + STILL_OVERDUE_AFTER
        <= day
        <= sent_on + STILL_OVERDUE_AFTER + CATCH_UP
    ):
        return False
    return _aware(ticket.updated_at) <= _aware(first.claimed_at)


def send_due_reminders(session: Session, now: Optional[datetime] = None) -> int:
    """Raise every reminder that is due at `now`. Returns how many were claimed."""
    now = now or datetime.now(timezone.utc)
    # Wide enough for any timezone's today, and for the latest the reminder
    # a week after can be: a first one sent at the end of its catch-up, and a
    # second at the end of its own.
    today = now.date()
    earliest = today - timedelta(days=2) - 2 * CATCH_UP - STILL_OVERDUE_AFTER
    latest = today + timedelta(days=2)

    tickets = session.exec(
        select(Ticket)
        .join(Team, Team.id == Ticket.team_id)
        .where(
            Ticket.due_date != None,  # noqa: E711 -- SQL IS NOT NULL
            Ticket.due_date >= earliest,
            Ticket.due_date <= latest,
            ~in_category(*RESOLVED),
            Team.archived_at == None,  # noqa: E711 -- SQL IS NULL
        )
        .order_by(Ticket.id)
    ).all()

    claimed = 0
    for ticket in tickets:
        if ticket.assignee_id is not None:
            recipients = {ticket.assignee_id}
        else:
            recipients = notifications.watcher_ids(session, ticket.id)
        # Narrowed before anything is claimed, so a claim is a reminder
        # somebody could receive. Their switches are `_raise`'s to read.
        recipients = notifications.reachable(session, ticket, recipients)
        if not recipients:
            continue
        users = session.exec(select(User).where(User.id.in_(recipients))).all()

        for user in users:
            zone = _zone(user)
            day = reminder_day(now, zone)
            stage = _stage(day, ticket.due_date)
            if stage is None:
                continue
            if stage == Stage.still_overdue and not _still_overdue(
                session, ticket, user.id, day, zone
            ):
                continue
            if not _claim(
                session,
                DueReminder(
                    ticket_id=ticket.id,
                    user_id=user.id,
                    due_date=ticket.due_date,
                    stage=stage.value,
                    claimed_at=now,
                ),
            ):
                continue
            # Committed before the notification is raised, as the digest
            # claims before it sends: a crash in between loses a reminder,
            # which is better than sending one twice.
            session.commit()
            claimed += 1
            notifications.raise_reminder(
                session, ticket, user.id, KIND[stage], ticket.due_date
            )
            session.commit()

    return claimed


async def reminder_loop(interval_seconds: float = 300.0) -> None:
    """Sweep for due reminders every few minutes, forever, off any request.

    In-process like the digest and trash loops, because the promise is
    `docker compose up`; the claim makes it safe to run in every worker.
    """
    from web import engine

    def tick() -> None:
        with Session(engine) as session:
            sent = send_due_reminders(session)
        if sent:
            logger.info("Sent %s due-date reminders", sent)

    while True:
        try:
            await asyncio.to_thread(tick)
        except Exception:
            # One bad tick must not end the loop; the next one may well work.
            logger.exception("The due-date reminder sweep failed")
        await asyncio.sleep(interval_seconds)

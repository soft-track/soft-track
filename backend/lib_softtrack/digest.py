"""The batched email digest, and the loop that drives it.

Email is the optional half of notifications: this module adds a nudge for the
ones nobody has read yet, of the kinds each person chose to have by email
(#263). A kind turned off in the app but kept by email is a row the inbox
does not show, and so is never read: it goes out here like any other.

Batched rather than one mail per event, which is the difference between a
useful notification and a filter rule. A notification has to sit unread for
`digest_delay_minutes` before it is eligible, so somebody triaging a dozen
tickets in one sitting produces one email rather than twelve, and anybody
already reading the inbox gets no email at all.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import update
from sqlmodel import Session, select

from lib_softtrack.metrics import DIGEST_SENDS
from lib_softtrack.models.notifications import NotificationRead
from lib_softtrack.notifications import expand_notifications
from lib_softtrack.tables import Notification, NotificationKind, User
from lib_utils.mailer import Mailer

logger = logging.getLogger(__name__)

#: Never put more than this many lines in one mail. Past it the digest stops
#: being readable and the inbox is the better place to look, which the last
#: line says.
MAX_LINES = 20


#: The two that come from a date (#262), listed under their own heading.
REMINDERS = (NotificationKind.due_tomorrow, NotificationKind.overdue)
#: What happens on a ticket somebody watches, for the heading over the rest
#: when that is all the rest is.
WATCHED = (NotificationKind.commented, NotificationKind.status_changed)
#: The rest, counted in a subject beside the reminders: "and 1 comment".
_NOUNS = {
    NotificationKind.assigned: ("assignment", "assignments"),
    NotificationKind.field_assigned: ("assignment", "assignments"),
    NotificationKind.mentioned: ("mention", "mentions"),
    NotificationKind.commented: ("comment", "comments"),
    NotificationKind.status_changed: ("status change", "status changes"),
}


def _day(value) -> str:
    """A due date the way the inbox writes it, without the year: "29 Sep"."""
    return f"{value.day} {value.strftime('%b')}"


def _reminder(item: NotificationRead) -> str:
    """What follows the ticket's title: "due tomorrow", "overdue since 29 Sep"."""
    if item.kind == NotificationKind.due_tomorrow:
        return "due tomorrow"
    return f"overdue since {_day(item.due_date)}" if item.due_date else "overdue"


def _counted(count: int, noun: tuple[str, str]) -> str:
    return f"{count} {noun[0] if count == 1 else noun[1]}"


def _subject_with_reminders(reminders: int, others: list[NotificationRead]) -> str:
    """The reminders, and the rest by what they are when they are all one
    thing: "2 reminders and 1 comment"."""
    subject = _counted(reminders, ("reminder", "reminders"))
    if not others:
        return subject
    nouns = {_NOUNS[item.kind] for item in others}
    if len(nouns) == 1:
        return f"{subject} and {_counted(len(others), nouns.pop())}"
    other = ("other notification", "other notifications")
    return f"{subject} and {_counted(len(others), other)}"


def _sentence(item: NotificationRead) -> str:
    if item.kind in REMINDERS:
        return f"{item.ticket.identifier} is {_reminder(item)}"
    who = item.actor.full_name if item.actor else "Someone"
    if item.kind == NotificationKind.assigned:
        return f"{who} assigned {item.ticket.identifier} to you"
    if item.kind == NotificationKind.mentioned:
        return f"{who} mentioned you on {item.ticket.identifier}"
    if item.kind == NotificationKind.commented:
        return f"{who} commented on {item.ticket.identifier}"
    if item.kind == NotificationKind.field_assigned:
        field = item.field_name or "a field"
        return f"{who} set you as {field} on {item.ticket.identifier}"
    return f"{who} changed the status of {item.ticket.identifier}"


def render_digest(items: list[NotificationRead], base_url: str) -> tuple[str, str]:
    """The subject and plain-text body for one person's batch.

    Plain text only. A tracker's digest is a list of one-line facts and a link
    per line; an HTML part would be a second template to keep in step for no
    reader who is better served by it.
    """
    count = len(items)
    reminders = [item for item in items if item.kind in REMINDERS]
    others = [item for item in items if item.kind not in REMINDERS]
    if count == 1:
        subject = f"SoftTrack: {_sentence(items[0])}"
    elif reminders:
        subject = f"SoftTrack: {_subject_with_reminders(len(reminders), others)}"
    else:
        subject = f"SoftTrack: {count} new notifications"

    base = base_url.rstrip("/")

    def link(item: NotificationRead) -> str:
        return f"  {base}/{item.ticket.team_key}/ticket/{item.ticket.number}"

    lines: list[str] = []
    shown = 0
    # Reminders first, under their own heading (#262), and only with one
    # when there are any: a digest of comments reads as it always did.
    if reminders:
        lines.append("REMINDERS")
        lines.append("")
        for item in reminders[:MAX_LINES]:
            lines.append(
                f"* {item.ticket.identifier} {item.ticket.title} · {_reminder(item)}"
            )
            lines.append(link(item))
            lines.append("")
            shown += 1
        if others and shown < MAX_LINES:
            heading = (
                "ON TICKETS YOU WATCH"
                if all(item.kind in WATCHED for item in others)
                else "EVERYTHING ELSE"
            )
            lines.append(heading)
            lines.append("")
    for item in others[: MAX_LINES - shown]:
        lines.append(f"* {_sentence(item)}")
        lines.append(f"  {item.ticket.title}")
        if item.excerpt:
            lines.append(f"  “{item.excerpt}”")
        lines.append(link(item))
        lines.append("")

    if count > MAX_LINES:
        lines.append(f"…and {count - MAX_LINES} more.")
        lines.append("")

    lines.append("Read them in SoftTrack:")
    lines.append(base)
    lines.append("")
    lines.append(
        "Choose which of these reach you by email in Settings → Notifications."
    )
    return subject, "\n".join(lines)


def _claim(session: Session, notification_ids: list[int], now: datetime) -> list[int]:
    """Stamp `emailed_at` on the rows still unclaimed, and say which those were.

    The guard in the WHERE clause is what makes the loop safe to run in more
    than one process: two workers can select the same candidates, and only one
    of them comes back with the ids. Sending before claiming would be the
    version that mails somebody twice.
    """
    claimed = session.exec(
        update(Notification)
        .where(
            Notification.id.in_(notification_ids),
            Notification.emailed_at == None,  # noqa: E711 -- SQL IS NULL
        )
        .values(emailed_at=now)
        .returning(Notification.id)
    ).all()
    session.commit()
    # RETURNING hands back one-column Rows, and a Row is not a tuple in
    # SQLAlchemy 2 -- comparing them to ids directly silently matches nothing.
    return [row[0] for row in claimed]


def send_pending_digests(
    session: Session,
    mailer: Mailer,
    base_url: str,
    delay_minutes: int,
    now: datetime | None = None,
) -> int:
    """Send one digest to everyone with something worth mailing. Returns the count."""
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=delay_minutes)

    rows = session.exec(
        select(Notification, User)
        .join(User, User.id == Notification.user_id)
        .where(
            Notification.emailed_at == None,  # noqa: E711 -- SQL IS NULL
            # Already read means already seen. The mail would be telling
            # somebody about something they have dealt with.
            Notification.read_at == None,  # noqa: E711 -- SQL IS NULL
            Notification.created_at <= cutoff,
            # Whether this kind reaches this person by email, decided when
            # it was raised (#263) -- see notifications._channels.
            Notification.by_email == True,  # noqa: E712 -- SQL comparison
            User.is_active == True,  # noqa: E712 -- SQL comparison
        )
        .order_by(Notification.created_at)
    ).all()

    by_user: dict[int, tuple[User, list[Notification]]] = {}
    for notification, user in rows:
        by_user.setdefault(user.id, (user, []))[1].append(notification)

    sent = 0
    for user, notifications in by_user.values():
        claimed = set(_claim(session, [row.id for row in notifications], now))
        mine = [row for row in notifications if row.id in claimed]
        if not mine:
            continue

        subject, body = render_digest(expand_notifications(session, mine), base_url)
        try:
            mailer.send(user.email, subject, body)
            DIGEST_SENDS.labels(result="success").inc()
            sent += 1
        except Exception:
            DIGEST_SENDS.labels(result="failure").inc()
            # The rows stay claimed. Everything in them is already in the
            # user's inbox, so nothing is lost by not retrying -- whereas a
            # relay that rejects every message would otherwise have this loop
            # re-sending the same batch every tick for as long as it is broken.
            logger.exception("Could not send the notification digest to %s", user.email)

    return sent


async def digest_loop() -> None:
    """Wake up every `digest_interval_minutes` and send whatever is due.

    In-process rather than a cron entry or a task queue, because the thing
    this project promises is `docker compose up`. The claim in `_claim` is
    what makes that safe when the process is replicated.

    smtplib blocks, so the whole tick runs in a worker thread; the event loop
    stays free for requests.
    """
    from lib_utils.mailer import get_mailer
    from web import engine, settings

    def tick() -> None:
        with Session(engine) as session:
            send_pending_digests(
                session,
                get_mailer(),
                settings.app_base_url,
                settings.digest_delay_minutes,
            )

    while True:
        await asyncio.sleep(settings.digest_interval_minutes * 60)
        try:
            await asyncio.to_thread(tick)
        except Exception:
            # One bad tick must not end the loop; the next one may well work.
            logger.exception("The notification digest tick failed")

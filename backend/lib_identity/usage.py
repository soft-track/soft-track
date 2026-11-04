"""How much the instance is used, for the site admin who looks after it (#312).

Whether anybody uses it, how fast its attachments grow and whether its email
arrives were all questions a site admin answered with SQL. The Prometheus
endpoint (#100) is for machines that watch an instance; Administration ->
Usage is for the person who looks after one.

Counts, and nothing of the content. Teams are named, because they are what a
site admin looks after; tickets, comments and files are not -- no title, no
file name, no address. Nothing is sent anywhere: the numbers are worked out
when the page asks, each by an aggregate in the database, and go to that page
and nowhere else.

Email is the one thing nothing kept a record of, so `record_mail` keeps the
smallest one that answers it: a row per message handed to the mail server,
with what the server said if it refused, for as long as the page reads it.
"""

from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import and_, case, delete, or_
from sqlmodel import Session, col, func, select

from lib_identity.models.usage import (
    EmailUsage,
    FileKind,
    LargestFile,
    MailError,
    PeopleUsage,
    StorageUsage,
    TeamStorage,
    TeamWebhookFailures,
    TokenUsage,
    UsageRead,
    WeekCount,
    WorkUsage,
)
from lib_softtrack.reports import RESOLVED
from lib_softtrack.tables import (
    ApiToken,
    Attachment,
    MailAttempt,
    OutboundWebhook,
    Team,
    Ticket,
    TicketEvent,
    TicketEventField,
    User,
    WebhookDelivery,
    utcnow,
)
from lib_softtrack.trash import INCLUDE_TRASHED
from web import settings

#: The weeks of tickets shown: a quarter.
WEEKS = 13
#: How far back email is counted, and how long its rows are kept.
MAIL_WINDOW = timedelta(days=7)
#: How many of the largest files are listed.
LARGEST = 5


def usage(session: Session) -> UsageRead:
    now = utcnow()
    return UsageRead(
        people=_people(session, now),
        work=_work(session, now),
        storage=_storage(session),
        email=_email(session, now),
        webhooks=_webhooks(session),
        api_tokens=_tokens(session, now),
    )


def _count(condition):
    """A count of the rows `condition` holds for, in a query over many."""
    return func.coalesce(func.sum(case((condition, 1), else_=0)), 0)


def _people(session: Session, now: datetime) -> PeopleUsage:
    active = User.is_active == True  # noqa: E712 -- SQL comparison
    activated = User.is_activated == True  # noqa: E712
    row = session.exec(
        select(
            _count(and_(active, activated)),
            _count(and_(active, ~activated)),
            _count(~active),
            _count(User.last_login_at >= now - timedelta(days=7)),
            _count(User.last_login_at >= now - timedelta(days=30)),
        )
    ).one()
    return PeopleUsage(
        active=row[0],
        not_activated=row[1],
        deactivated=row[2],
        signed_in_last_7_days=row[3],
        signed_in_last_30_days=row[4],
    )


def _day(value) -> date:
    """`date()` is a string on SQLite and a date on Postgres."""
    return value if isinstance(value, date) else date.fromisoformat(value)


def _monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _per_week(session: Session, statement, moment) -> dict[date, int]:
    """Rows per week, counted per day by the database -- a quarter is at most
    ninety-one rows back, however many tickets there are -- and added up into
    weeks here, which SQLite and Postgres would each spell differently."""
    day = func.date(moment)
    weeks: dict[date, int] = {}
    for value, count in session.exec(
        statement.add_columns(day, func.count()).group_by(day)
    ).all():
        monday = _monday(_day(value))
        weeks[monday] = weeks.get(monday, 0) + count
    return weeks


def _work(session: Session, now: datetime) -> WorkUsage:
    archived = col(Team.archived_at).is_not(None)
    teams, archived_teams = session.exec(
        select(_count(~archived), _count(archived))
    ).one()

    first = _monday(now.date()) - timedelta(weeks=WEEKS - 1)
    since = datetime.combine(first, datetime.min.time(), tzinfo=now.tzinfo)
    # Outside the trash, as the reports count, which the session listener
    # sees to.
    created = _per_week(
        session,
        select().select_from(Ticket).where(Ticket.created_at >= since),
        Ticket.created_at,
    )
    resolved = [category.value for category in RESOLVED]
    closed = _per_week(
        session,
        select()
        .select_from(TicketEvent)
        .where(
            TicketEvent.field == TicketEventField.status,
            col(TicketEvent.new_value).in_(resolved),
            or_(
                col(TicketEvent.old_value).is_(None),
                col(TicketEvent.old_value).not_in(resolved),
            ),
            TicketEvent.created_at >= since,
        ),
        TicketEvent.created_at,
    )
    weeks = [first + timedelta(weeks=index) for index in range(WEEKS)]
    return WorkUsage(
        teams=teams,
        archived_teams=archived_teams,
        weeks=[
            WeekCount(
                week_of=week,
                created=created.get(week, 0),
                closed=closed.get(week, 0),
            )
            for week in weeks
        ],
    )


def file_kind(content_type: str) -> FileKind:
    """A kind from the closed set of types an attachment is stored as (see
    `ALLOWED_TYPES` in lib_softtrack/attachments.py)."""
    family = content_type.split("/", 1)[0]
    if family == "image":
        return FileKind.image
    if family == "video":
        return FileKind.video
    if content_type == "application/pdf":
        return FileKind.document
    if content_type == "application/zip":
        return FileKind.archive
    if family == "text" or content_type == "application/json":
        return FileKind.text
    return FileKind.other


def _storage(session: Session) -> StorageUsage:
    size_bytes, files = session.exec(
        select(func.coalesce(func.sum(Attachment.size_bytes), 0), func.count())
    ).one()
    total = func.sum(Attachment.size_bytes)
    # The trash too: what is in it is stored until it is purged.
    teams = session.exec(
        select(Team.id, Team.name, total)
        .select_from(Attachment)
        .join(Ticket, Ticket.id == Attachment.ticket_id)
        .join(Team, Team.id == Ticket.team_id)
        .group_by(Team.id, Team.name)
        .order_by(total.desc(), func.lower(Team.name))
        .execution_options(**INCLUDE_TRASHED)
    ).all()
    largest = session.exec(
        select(Attachment.content_type, Attachment.size_bytes, Team.id, Team.name)
        .select_from(Attachment)
        .join(Ticket, Ticket.id == Attachment.ticket_id)
        .join(Team, Team.id == Ticket.team_id)
        .order_by(col(Attachment.size_bytes).desc(), Attachment.id)
        .limit(LARGEST)
        .execution_options(**INCLUDE_TRASHED)
    ).all()
    return StorageUsage(
        size_bytes=size_bytes,
        files=files,
        teams=[
            TeamStorage(team_id=team_id, team_name=name, size_bytes=team_bytes)
            for team_id, name, team_bytes in teams
        ],
        largest=[
            LargestFile(
                kind=file_kind(content_type),
                team_id=team_id,
                team_name=name,
                size_bytes=file_bytes,
            )
            for content_type, file_bytes, team_id, name in largest
        ],
    )


def _email(session: Session, now: datetime) -> EmailUsage:
    since = now - MAIL_WINDOW
    failed = col(MailAttempt.error).is_not(None)
    sent, failures = session.exec(
        select(_count(~failed), _count(failed)).where(MailAttempt.attempted_at >= since)
    ).one()
    last = session.exec(
        select(MailAttempt)
        .where(failed, MailAttempt.attempted_at >= since)
        .order_by(col(MailAttempt.attempted_at).desc(), col(MailAttempt.id).desc())
        .limit(1)
    ).first()
    return EmailUsage(
        configured=settings.email_delivery_configured,
        sent=sent,
        failed=failures,
        last_error=(
            MailError(
                at=last.attempted_at, recipients=last.recipients, error=last.error
            )
            if last is not None
            else None
        ),
    )


def _webhooks(session: Session) -> list[TeamWebhookFailures]:
    """Deliveries still in each webhook's log -- its last fifty -- that
    failed every try, by team. A team whose webhooks have not failed is
    listed with none: that is an answer too."""
    failed = func.count(WebhookDelivery.id)
    return [
        TeamWebhookFailures(team_id=team_id, team_name=name, failed=count)
        for team_id, name, count in session.exec(
            select(Team.id, Team.name, failed)
            .select_from(OutboundWebhook)
            .join(Team, Team.id == OutboundWebhook.team_id)
            .outerjoin(
                WebhookDelivery,
                and_(
                    WebhookDelivery.webhook_id == OutboundWebhook.id,
                    WebhookDelivery.status == "failed",
                ),
            )
            .group_by(Team.id, Team.name)
            .order_by(failed.desc(), func.lower(Team.name))
        ).all()
    ]


def _tokens(session: Session, now: datetime) -> TokenUsage:
    live, never_used = session.exec(
        select(func.count(), _count(col(ApiToken.last_used_at).is_(None)))
        .select_from(ApiToken)
        .join(User, User.id == ApiToken.user_id)
        .where(
            User.is_active == True,  # noqa: E712 -- SQL comparison
            or_(col(ApiToken.expires_at).is_(None), ApiToken.expires_at > now),
        )
    ).one()
    return TokenUsage(live=live, never_used=never_used)


def record_mail(error: Optional[str], recipients: int = 1) -> None:
    """Write down one message handed to the mail server, from
    `SMTPMailer.send`, and sweep the rows the page no longer reads.

    In a session of its own: mail goes from background tasks and the digest's
    thread, after the request that asked for it has finished with its own.
    """
    from web import engine

    now = utcnow()
    with Session(engine) as session:
        session.execute(
            delete(MailAttempt).where(MailAttempt.attempted_at < now - MAIL_WINDOW)
        )
        session.add(MailAttempt(attempted_at=now, error=error, recipients=recipients))
        session.commit()

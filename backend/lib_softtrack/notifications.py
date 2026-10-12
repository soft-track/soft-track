"""Watching tickets, raising notifications, and reading the inbox.

Every notification in SoftTrack starts here. The ticket and comment services
call the three `on_*` hooks below and know nothing else about it -- the same
arrangement as `history.py`, and for the same reason: "who gets told what"
is one policy, and it is only correct if it lives in one place.

Two rules the hooks all obey, so no caller has to remember them:

* Nobody is notified about their own action. An inbox that tells you what you
  just did is an inbox people learn to ignore.
* One notification per person per event. An update that assigns a ticket *and*
  moves it to In Progress is one thing that happened, and the assignment is
  the part worth saying.

And one rule the reader sets (#263): which kinds reach them, in the app and by
email, and which teams they have muted. `_channels` reads it for every row,
so a hook never has to.
"""

from datetime import date, datetime, timezone
from typing import Iterable, Optional

from sqlmodel import Session, func, select

from lib_identity.models.identity import UserPublic
from lib_softtrack import outside
from lib_softtrack.mentions import mentioned_user_ids
from lib_softtrack.models.notifications import (
    ChannelSetting,
    NotificationKindSetting,
    NotificationTicket,
    NotificationRead,
    NotificationSettings,
    NotificationSettingsUpdate,
    TeamNotificationSetting,
    UnreadCount,
    WatchState,
)
from lib_softtrack.notification_kinds import (
    KINDS,
    KindSpec,
    NotificationChannel,
    spec_for,
)
from lib_softtrack.models.page import DEFAULT_LIMIT, Page
from lib_softtrack.tables import (
    Comment,
    CustomField,
    DueReminder,
    Ticket,
    TicketWatch,
    Notification,
    NotificationKind,
    NotificationPreference,
    Team,
    TeamMember,
    User,
)
from lib_utils.errors import ErrorCode, api_error

#: How much of a comment the inbox quotes. Long enough to recognise which
#: comment it was, short enough that a row stays one line on a phone.
EXCERPT_LENGTH = 140


# ---------------------------------------------------------------------------
# Watching
# ---------------------------------------------------------------------------


def watcher_ids(session: Session, ticket_id: int) -> set[int]:
    rows = session.exec(
        select(TicketWatch.user_id).where(
            TicketWatch.ticket_id == ticket_id,
            TicketWatch.watching == True,  # noqa: E712 -- SQL comparison
        )
    ).all()
    return set(rows)


def _watch_row(session: Session, ticket_id: int, user_id: int) -> Optional[TicketWatch]:
    return session.exec(
        select(TicketWatch).where(
            TicketWatch.ticket_id == ticket_id, TicketWatch.user_id == user_id
        )
    ).first()


def auto_watch(session: Session, ticket_id: int, user_id: int) -> None:
    """Start watching because of something the person did.

    Only when they have never expressed a preference. Someone who unwatched a
    ticket and then answered a question on it meant to answer the question, not
    to resubscribe -- see TicketWatch's docstring.
    """
    if _watch_row(session, ticket_id, user_id) is None:
        session.add(TicketWatch(ticket_id=ticket_id, user_id=user_id))


def get_watch_state(session: Session, current_user: User, ticket_id: int) -> WatchState:
    from lib_softtrack.tickets import get_ticket_or_404
    from lib_softtrack.teams import require_team_member

    ticket = get_ticket_or_404(session, ticket_id)
    require_team_member(ticket.team_id, current_user, session)

    row = _watch_row(session, ticket_id, current_user.id)
    return WatchState(watching=bool(row and row.watching))


def set_watching(
    session: Session, current_user: User, ticket_id: int, watching: bool
) -> WatchState:
    from lib_softtrack.tickets import get_ticket_or_404
    from lib_softtrack.teams import require_team_member

    ticket = get_ticket_or_404(session, ticket_id)
    require_team_member(ticket.team_id, current_user, session)

    row = _watch_row(session, ticket_id, current_user.id)
    if row is None:
        row = TicketWatch(ticket_id=ticket_id, user_id=current_user.id)
    row.watching = watching
    session.add(row)
    session.commit()
    return WatchState(watching=watching)


# ---------------------------------------------------------------------------
# Raising
# ---------------------------------------------------------------------------


def _deliverable(session: Session, team_id: int, user_ids: Iterable[int]) -> set[int]:
    """Narrow a set of recipients to people who should still hear about it.

    Current members of the ticket's team, and active accounts. Watches outlive
    membership -- somebody who left the team last month is still a row in
    `ticketwatch` -- and continuing to mail them the team's business is a leak,
    not a courtesy.
    """
    ids = {user_id for user_id in user_ids if user_id is not None}
    if not ids:
        return set()

    rows = session.exec(
        select(User.id)
        .join(TeamMember, TeamMember.user_id == User.id)
        .where(
            TeamMember.team_id == team_id,
            User.id.in_(ids),
            User.is_active == True,  # noqa: E712 -- SQL comparison
        )
    ).all()
    return set(rows)


def _raise(
    session: Session,
    *,
    recipients: Iterable[int],
    kind: NotificationKind,
    ticket: Ticket,
    actor: Optional[User],
    comment: Optional[Comment] = None,
    custom_field: Optional[CustomField] = None,
    due_date: Optional[date] = None,
) -> None:
    """Add a row per recipient. Flushed with whatever transaction is open.

    Never to somebody from outside the organisation who cannot see the ticket
    (#243): a mention or a watch reaches only as far as their epics do.
    """
    deliverable = reachable(session, ticket, recipients)
    channels = _channels(session, spec_for(kind), ticket.team_id, deliverable)
    for user_id, (in_app, by_email) in channels.items():
        if not (in_app or by_email):
            continue
        session.add(
            Notification(
                user_id=user_id,
                kind=kind,
                in_app=in_app,
                by_email=by_email,
                ticket_id=ticket.id,
                comment_id=comment.id if comment else None,
                actor_id=actor.id if actor else None,
                custom_field_id=custom_field.id if custom_field else None,
                due_date=due_date,
            )
        )


def reachable(session: Session, ticket: Ticket, user_ids: Iterable[int]) -> set[int]:
    """Who of these may be told anything about this ticket at all: active
    members of its team who can see it."""
    deliverable = _deliverable(session, ticket.team_id, user_ids)
    deliverable -= outside.unable_to_see(session, ticket, deliverable)
    return deliverable


def raise_reminder(
    session: Session,
    ticket: Ticket,
    user_id: int,
    kind: NotificationKind,
    due_date: date,
) -> None:
    """A due-date reminder (#262), raised by `lib_softtrack.reminders`. Nobody
    did it, so there is no actor; the person's switches still decide."""
    _raise(
        session,
        recipients={user_id},
        kind=kind,
        ticket=ticket,
        actor=None,
        due_date=due_date,
    )


def _channels(
    session: Session, spec: KindSpec, team_id: int, user_ids: set[int]
) -> dict[int, tuple[bool, bool]]:
    """Where a notification of this kind reaches each person: (app, email).

    Their choice for the kind where they made one, and its default where they
    did not -- by email, only if they had not turned email off before there
    was a choice to make (`User.email_notifications`). A muted team reaches
    nobody, except with a kind that gets through a mute.

    Decided now and kept on the row, rather than when the digest runs: a
    switch turned off stops what happens next, and leaves alone what has
    already arrived.
    """
    if not user_ids:
        return {}

    muted: set[int] = set()
    if not spec.through_mute:
        muted = set(
            session.exec(
                select(TeamMember.user_id).where(
                    TeamMember.team_id == team_id,
                    TeamMember.user_id.in_(user_ids),
                    TeamMember.notifications_muted == True,  # noqa: E712
                )
            ).all()
        )
    chosen = {
        (row.user_id, row.channel): row.enabled
        for row in session.exec(
            select(NotificationPreference).where(
                NotificationPreference.user_id.in_(user_ids),
                NotificationPreference.kind == spec.key,
            )
        ).all()
    }
    email_on = dict(
        session.exec(
            select(User.id, User.email_notifications).where(User.id.in_(user_ids))
        ).all()
    )

    app, email = NotificationChannel.app.value, NotificationChannel.email.value
    result: dict[int, tuple[bool, bool]] = {}
    for user_id in user_ids - muted:
        in_app = spec.always_in_app or chosen.get((user_id, app), spec.default)
        by_email = chosen.get(
            (user_id, email), spec.default and email_on.get(user_id, True)
        )
        result[user_id] = (in_app, by_email)
    return result


def _named_in_fields(
    session: Session,
    ticket: Ticket,
    named: dict[int, CustomField],
    actor: Optional[User],
    already: set[int],
) -> set[int]:
    """Tell the people newly set in a user field (#117), as assignment does.

    Being made somebody's reviewer is assignment by another name: it
    watches the ticket for them, and tells them unless they did it
    themselves. Somebody the same update also assigned has been told once
    already. Returns who was told, for the hooks to subtract from the rest.
    """
    told: set[int] = set()
    for user_id, field in named.items():
        auto_watch(session, ticket.id, user_id)
        if user_id in already or user_id in _own(actor):
            continue
        told.add(user_id)
        _raise(
            session,
            recipients={user_id},
            kind=NotificationKind.field_assigned,
            ticket=ticket,
            actor=actor,
            custom_field=field,
        )
    return told


def _own(actor: Optional[User]) -> set[int]:
    """The actor, as a set to subtract from a recipient list.

    Empty when there is no actor. Every hook below subtracts it to keep from
    telling somebody what they just did; with nobody behind the change there
    is nothing to keep quiet about.
    """
    return {actor.id} if actor is not None else set()


def on_ticket_created(
    session: Session,
    ticket: Ticket,
    actor: User,
    named: Optional[dict[int, CustomField]] = None,
) -> None:
    """Filing a ticket watches it; assigning it to someone tells them, and so
    does naming them in one of the team's user fields (`named`).

    A mention does not auto-watch. Being named in a description is somebody
    else's decision about you, and it is a weaker signal than the three things
    you did yourself.
    """
    auto_watch(session, ticket.id, actor.id)

    assigned: set[int] = set()
    if ticket.assignee_id and ticket.assignee_id != actor.id:
        assigned = {ticket.assignee_id}
        auto_watch(session, ticket.id, ticket.assignee_id)
        _raise(
            session,
            recipients=assigned,
            kind=NotificationKind.assigned,
            ticket=ticket,
            actor=actor,
        )
    assigned |= _named_in_fields(session, ticket, named or {}, actor, assigned)

    mentioned = mentioned_user_ids(session, ticket.team_id, ticket.description)
    _raise(
        session,
        recipients=mentioned - assigned - {actor.id},
        kind=NotificationKind.mentioned,
        ticket=ticket,
        actor=actor,
    )


#: The fields whose movement is worth telling somebody about. Snapshotted
#: before an update the way `history.snapshot` is, and for the same reason:
#: a PATCH that sets a field to what it already held changed nothing, and
#: notifying on the payload rather than on the diff would say otherwise.
WATCHED_FIELDS = ("assignee_id", "status_id", "description")


def snapshot(ticket: Ticket) -> dict[str, object]:
    return {field: getattr(ticket, field) for field in WATCHED_FIELDS}


def on_ticket_updated(
    session: Session,
    ticket: Ticket,
    before: dict[str, object],
    actor: Optional[User],
    named: Optional[dict[int, CustomField]] = None,
) -> None:
    """Tell the new assignee, anyone newly set in a user field (`named`),
    anyone newly mentioned, and then the watchers.

    In that order, and each set subtracted from the next, so one PATCH is at
    most one notification per person.

    A null `actor` means an automation rule made the change. Nobody is
    subtracted in that case, deliberately: "nobody is notified about their own
    action" is about a person recognising what they just did, and a ticket
    that moved on its own is the opposite of that.
    """
    assigned: set[int] = set()
    if ticket.assignee_id != before.get("assignee_id") and ticket.assignee_id:
        auto_watch(session, ticket.id, ticket.assignee_id)
        if actor is None or ticket.assignee_id != actor.id:
            assigned = {ticket.assignee_id}
            _raise(
                session,
                recipients=assigned,
                kind=NotificationKind.assigned,
                ticket=ticket,
                actor=actor,
            )
    assigned |= _named_in_fields(session, ticket, named or {}, actor, assigned)

    mentioned: set[int] = set()
    if ticket.description != before.get("description"):
        # Only handles that were not there before. Editing a typo in a
        # description should not re-ping everyone it names.
        was = mentioned_user_ids(session, ticket.team_id, before.get("description"))
        mentioned = (
            mentioned_user_ids(session, ticket.team_id, ticket.description)
            - was
            - assigned
            - _own(actor)
        )
        _raise(
            session,
            recipients=mentioned,
            kind=NotificationKind.mentioned,
            ticket=ticket,
            actor=actor,
        )

    if ticket.status_id != before.get("status_id"):
        _raise(
            session,
            recipients=watcher_ids(session, ticket.id)
            - assigned
            - mentioned
            - _own(actor),
            kind=NotificationKind.status_changed,
            ticket=ticket,
            actor=actor,
        )


def on_comment_created(
    session: Session, ticket: Ticket, comment: Comment, actor: Optional[User]
) -> None:
    """A null `actor` is a comment an automation rule wrote -- see
    `Comment.author_id`. It watches nothing and excludes nobody."""
    if actor is not None:
        auto_watch(session, ticket.id, actor.id)

    mentioned = mentioned_user_ids(session, ticket.team_id, comment.body) - _own(actor)
    _raise(
        session,
        recipients=mentioned,
        kind=NotificationKind.mentioned,
        ticket=ticket,
        actor=actor,
        comment=comment,
    )
    _raise(
        session,
        recipients=watcher_ids(session, ticket.id) - mentioned - _own(actor),
        kind=NotificationKind.commented,
        ticket=ticket,
        actor=actor,
        comment=comment,
    )


def on_comment_edited(
    session: Session, ticket: Ticket, comment: Comment, before: str, actor: User
) -> None:
    """Tell anyone the edit newly names (#93), and nobody else.

    Only handles that were not in the old body, as for a description: fixing
    a typo should not re-ping everyone the comment mentions, and watchers
    heard about the comment when it was posted.
    """
    was = mentioned_user_ids(session, ticket.team_id, before)
    _raise(
        session,
        recipients=mentioned_user_ids(session, ticket.team_id, comment.body)
        - was
        - _own(actor),
        kind=NotificationKind.mentioned,
        ticket=ticket,
        actor=actor,
        comment=comment,
    )


def delete_for_comment(session: Session, comment_id: int) -> None:
    """Drop the notifications about a comment being deleted (#93).

    They hold a foreign key to it, and an inbox row quoting words their
    author took back is the one thing a delete should not leave behind.
    """
    for row in session.exec(
        select(Notification).where(Notification.comment_id == comment_id)
    ).all():
        session.delete(row)


def delete_for_ticket(session: Session, ticket_id: int) -> None:
    """Drop the watches and notifications pointing at a ticket being deleted.

    Both hold foreign keys to it (and to its comments), so this runs before
    the ticket goes. There is nothing to keep: an inbox row whose ticket no
    longer exists is a link to a 404.
    """
    for row in session.exec(
        select(Notification).where(Notification.ticket_id == ticket_id)
    ).all():
        session.delete(row)
    for row in session.exec(
        select(TicketWatch).where(TicketWatch.ticket_id == ticket_id)
    ).all():
        session.delete(row)
    # And the record of which reminders went out (#262).
    for row in session.exec(
        select(DueReminder).where(DueReminder.ticket_id == ticket_id)
    ).all():
        session.delete(row)


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


def excerpt(body: str) -> str:
    """A one-line taste of a comment, with the markdown left as written.

    Not rendered and not stripped: `**shipped**` reads fine as an excerpt, and
    a markdown parser here would be a second renderer to keep in step with the
    one in the frontend.
    """
    collapsed = " ".join(body.split())
    if len(collapsed) <= EXCERPT_LENGTH:
        return collapsed
    return collapsed[: EXCERPT_LENGTH - 1].rstrip() + "…"


def expand_notifications(
    session: Session, notifications: list[Notification]
) -> list[NotificationRead]:
    """Build the payload for a page with a fixed number of queries."""
    if not notifications:
        return []

    tickets = {
        ticket.id: ticket
        for ticket in session.exec(
            select(Ticket).where(
                Ticket.id.in_({row.ticket_id for row in notifications})
            )
        ).all()
    }
    teams = {
        team.id: team
        for team in session.exec(
            select(Team).where(
                Team.id.in_({ticket.team_id for ticket in tickets.values()})
            )
        ).all()
    }
    actors = {
        user.id: user
        for user in session.exec(
            select(User).where(
                User.id.in_({row.actor_id for row in notifications if row.actor_id})
            )
        ).all()
    }
    comments = {
        comment.id: comment
        for comment in session.exec(
            select(Comment).where(
                Comment.id.in_(
                    {row.comment_id for row in notifications if row.comment_id}
                )
            )
        ).all()
    }
    field_ids = {row.custom_field_id for row in notifications if row.custom_field_id}
    field_names = (
        {
            field.id: field.name
            for field in session.exec(
                select(CustomField).where(CustomField.id.in_(field_ids))
            ).all()
        }
        if field_ids
        else {}
    )

    expanded = []
    for row in notifications:
        ticket = tickets.get(row.ticket_id)
        team = teams.get(ticket.team_id) if ticket else None
        if ticket is None or team is None:
            # Unreachable while `delete_for_ticket` runs on every ticket delete,
            # which is the point: if a path is ever added that misses it, the
            # inbox skips the orphan rather than returning a 500 for every
            # notification the person has.
            continue
        comment = comments.get(row.comment_id) if row.comment_id else None
        actor = actors.get(row.actor_id) if row.actor_id else None
        expanded.append(
            NotificationRead(
                id=row.id,
                kind=row.kind,
                ticket=NotificationTicket(
                    id=ticket.id,
                    team_id=ticket.team_id,
                    team_key=team.key,
                    number=ticket.number,
                    identifier=f"{team.key}-{ticket.number}",
                    title=ticket.title,
                ),
                actor=UserPublic.model_validate(actor) if actor else None,
                excerpt=excerpt(comment.body) if comment else None,
                field_name=field_names.get(row.custom_field_id),
                due_date=row.due_date,
                assigned_to_you=ticket.assignee_id == row.user_id,
                read=row.read_at is not None,
                created_at=row.created_at,
            )
        )
    return expanded


def list_notifications(
    session: Session,
    current_user: User,
    unread_only: bool = False,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
) -> Page[NotificationRead]:
    filters = [
        Notification.user_id == current_user.id,
        Notification.in_app == True,  # noqa: E712 -- SQL comparison
    ]
    if unread_only:
        filters.append(Notification.read_at == None)  # noqa: E711 -- SQL IS NULL

    total = session.exec(
        select(func.count()).select_from(Notification).where(*filters)
    ).one()

    rows = session.exec(
        select(Notification)
        .where(*filters)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()

    return Page(
        items=expand_notifications(session, list(rows)),
        total=total,
        limit=limit,
        offset=offset,
    )


def unread_count(session: Session, current_user: User) -> UnreadCount:
    total = session.exec(
        select(func.count())
        .select_from(Notification)
        .where(
            Notification.user_id == current_user.id,
            Notification.in_app == True,  # noqa: E712 -- SQL comparison
            Notification.read_at == None,  # noqa: E711 -- SQL IS NULL
        )
    ).one()
    return UnreadCount(unread=total)


def set_read(
    session: Session, current_user: User, notification_id: int, read: bool
) -> NotificationRead:
    row = session.get(Notification, notification_id)
    # 404 rather than 403 for someone else's notification: the caller has no
    # business learning that the id exists.
    if row is None or row.user_id != current_user.id or not row.in_app:
        raise api_error(
            status_code=404,
            code=ErrorCode.notification_not_found,
            detail="Notification not found",
        )

    row.read_at = datetime.now(timezone.utc) if read else None
    session.add(row)
    session.commit()
    session.refresh(row)
    return expand_notifications(session, [row])[0]


def mark_all_read(session: Session, current_user: User) -> UnreadCount:
    now = datetime.now(timezone.utc)
    for row in session.exec(
        select(Notification).where(
            Notification.user_id == current_user.id,
            Notification.in_app == True,  # noqa: E712 -- SQL comparison
            Notification.read_at == None,  # noqa: E711 -- SQL IS NULL
        )
    ).all():
        row.read_at = now
        session.add(row)
    session.commit()
    return UnreadCount(unread=0)


# ---------------------------------------------------------------------------
# Per-user preferences
# ---------------------------------------------------------------------------


def _offered_channels() -> list[NotificationChannel]:
    from web import settings

    # The email column follows the rule the email switch did: not offered
    # while nothing could send the mail.
    return [
        channel
        for channel in NotificationChannel
        if channel != NotificationChannel.email or settings.email_delivery_configured
    ]


def get_settings(session: Session, current_user: User) -> NotificationSettings:
    from web import settings

    channels = _offered_channels()
    chosen = {
        (row.kind, row.channel): row.enabled
        for row in session.exec(
            select(NotificationPreference).where(
                NotificationPreference.user_id == current_user.id
            )
        ).all()
    }

    def enabled(spec: KindSpec, channel: NotificationChannel) -> bool:
        if spec.locked(channel):
            return True
        default = spec.default
        if channel == NotificationChannel.email:
            default = default and current_user.email_notifications
        return chosen.get((spec.key, channel.value), default)

    kinds = [
        NotificationKindSetting(
            kind=spec.key,
            name=spec.name,
            description=spec.description,
            through_mute=spec.through_mute,
            channels=[
                ChannelSetting(
                    channel=channel,
                    enabled=enabled(spec, channel),
                    locked=spec.locked(channel),
                )
                for channel in channels
            ],
        )
        for spec in KINDS.values()
    ]

    teams = [
        TeamNotificationSetting(
            team_id=team.id,
            key=team.key,
            name=team.name,
            muted=member.notifications_muted,
        )
        for team, member in session.exec(
            select(Team, TeamMember)
            .join(TeamMember, TeamMember.team_id == Team.id)
            .where(
                TeamMember.user_id == current_user.id,
                Team.archived_at == None,  # noqa: E711 -- SQL IS NULL
            )
            .order_by(func.lower(Team.name))
        ).all()
    ]

    return NotificationSettings(
        email_delivery_configured=settings.email_delivery_configured,
        channels=channels,
        kinds=kinds,
        teams=teams,
    )


def update_settings(
    session: Session, current_user: User, payload: NotificationSettingsUpdate
) -> NotificationSettings:
    """Apply the switches, all or none: one that is refused saves nothing."""
    offered = _offered_channels()
    for change in payload.preferences:
        spec = KINDS.get(change.kind)
        if spec is None:
            raise api_error(
                status_code=404,
                code=ErrorCode.notification_kind_not_found,
                detail="There is no notification of that kind",
            )
        if change.channel not in offered:
            raise api_error(
                status_code=400,
                code=ErrorCode.notification_channel_unavailable,
                detail="This SoftTrack has no mail server configured",
            )
        if spec.locked(change.channel) and not change.enabled:
            raise api_error(
                status_code=400,
                code=ErrorCode.notification_always_on,
                detail="Being assigned and being mentioned always reach you in the app",
            )

    memberships = {
        member.team_id: member
        for member in session.exec(
            select(TeamMember).where(
                TeamMember.user_id == current_user.id,
                TeamMember.team_id.in_({change.team_id for change in payload.teams}),
            )
        ).all()
    }
    for change in payload.teams:
        if change.team_id not in memberships:
            raise api_error(
                status_code=403,
                code=ErrorCode.not_team_member,
                detail="Not a member of this team",
            )

    for change in payload.preferences:
        row = session.get(
            NotificationPreference,
            (current_user.id, change.kind, change.channel.value),
        )
        if row is None:
            row = NotificationPreference(
                user_id=current_user.id,
                kind=change.kind,
                channel=change.channel.value,
                enabled=change.enabled,
            )
        row.enabled = change.enabled
        session.add(row)
    for change in payload.teams:
        member = memberships[change.team_id]
        member.notifications_muted = change.muted
        session.add(member)

    session.commit()
    return get_settings(session, current_user)

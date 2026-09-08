"""Watching issues, raising notifications, and reading the inbox.

Every notification in SoftTrack starts here. The issue and comment services
call the three `on_*` hooks below and know nothing else about it -- the same
arrangement as `history.py`, and for the same reason: "who gets told what"
is one policy, and it is only correct if it lives in one place.

Two rules the hooks all obey, so no caller has to remember them:

* Nobody is notified about their own action. An inbox that tells you what you
  just did is an inbox people learn to ignore.
* One notification per person per event. An update that assigns an issue *and*
  moves it to In Progress is one thing that happened, and the assignment is
  the part worth saying.
"""

from datetime import datetime, timezone
from typing import Iterable, Optional

from fastapi import HTTPException
from sqlmodel import Session, func, select

from lib_identity.models.identity import UserPublic
from lib_softtrack.mentions import mentioned_user_ids
from lib_softtrack.models.notifications import (
    NotificationIssue,
    NotificationRead,
    NotificationSettings,
    UnreadCount,
    WatchState,
)
from lib_softtrack.models.page import DEFAULT_LIMIT, Page
from lib_softtrack.tables import (
    Comment,
    Issue,
    IssueWatch,
    Notification,
    NotificationKind,
    Team,
    TeamMember,
    User,
)

#: How much of a comment the inbox quotes. Long enough to recognise which
#: comment it was, short enough that a row stays one line on a phone.
EXCERPT_LENGTH = 140


# ---------------------------------------------------------------------------
# Watching
# ---------------------------------------------------------------------------


def watcher_ids(session: Session, issue_id: int) -> set[int]:
    rows = session.exec(
        select(IssueWatch.user_id).where(
            IssueWatch.issue_id == issue_id,
            IssueWatch.watching == True,  # noqa: E712 -- SQL comparison
        )
    ).all()
    return set(rows)


def _watch_row(session: Session, issue_id: int, user_id: int) -> Optional[IssueWatch]:
    return session.exec(
        select(IssueWatch).where(
            IssueWatch.issue_id == issue_id, IssueWatch.user_id == user_id
        )
    ).first()


def auto_watch(session: Session, issue_id: int, user_id: int) -> None:
    """Start watching because of something the person did.

    Only when they have never expressed a preference. Someone who unwatched an
    issue and then answered a question on it meant to answer the question, not
    to resubscribe -- see IssueWatch's docstring.
    """
    if _watch_row(session, issue_id, user_id) is None:
        session.add(IssueWatch(issue_id=issue_id, user_id=user_id))


def get_watch_state(session: Session, current_user: User, issue_id: int) -> WatchState:
    from lib_softtrack.issues import get_issue_or_404
    from lib_softtrack.teams import require_team_member

    issue = get_issue_or_404(session, issue_id)
    require_team_member(issue.team_id, current_user, session)

    row = _watch_row(session, issue_id, current_user.id)
    return WatchState(watching=bool(row and row.watching))


def set_watching(
    session: Session, current_user: User, issue_id: int, watching: bool
) -> WatchState:
    from lib_softtrack.issues import get_issue_or_404
    from lib_softtrack.teams import require_team_member

    issue = get_issue_or_404(session, issue_id)
    require_team_member(issue.team_id, current_user, session)

    row = _watch_row(session, issue_id, current_user.id)
    if row is None:
        row = IssueWatch(issue_id=issue_id, user_id=current_user.id)
    row.watching = watching
    session.add(row)
    session.commit()
    return WatchState(watching=watching)


# ---------------------------------------------------------------------------
# Raising
# ---------------------------------------------------------------------------


def _deliverable(session: Session, team_id: int, user_ids: Iterable[int]) -> set[int]:
    """Narrow a set of recipients to people who should still hear about it.

    Current members of the issue's team, and active accounts. Watches outlive
    membership -- somebody who left the team last month is still a row in
    `issuewatch` -- and continuing to mail them the team's business is a leak,
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
    issue: Issue,
    actor: Optional[User],
    comment: Optional[Comment] = None,
) -> None:
    """Add a row per recipient. Flushed with whatever transaction is open."""
    for user_id in _deliverable(session, issue.team_id, recipients):
        session.add(
            Notification(
                user_id=user_id,
                kind=kind,
                issue_id=issue.id,
                comment_id=comment.id if comment else None,
                actor_id=actor.id if actor else None,
            )
        )


def _own(actor: Optional[User]) -> set[int]:
    """The actor, as a set to subtract from a recipient list.

    Empty when there is no actor. Every hook below subtracts it to keep from
    telling somebody what they just did; with nobody behind the change there
    is nothing to keep quiet about.
    """
    return {actor.id} if actor is not None else set()


def on_issue_created(session: Session, issue: Issue, actor: User) -> None:
    """Filing an issue watches it; assigning it to someone tells them.

    A mention does not auto-watch. Being named in a description is somebody
    else's decision about you, and it is a weaker signal than the three things
    you did yourself.
    """
    auto_watch(session, issue.id, actor.id)

    assigned: set[int] = set()
    if issue.assignee_id and issue.assignee_id != actor.id:
        assigned = {issue.assignee_id}
        auto_watch(session, issue.id, issue.assignee_id)
        _raise(
            session,
            recipients=assigned,
            kind=NotificationKind.assigned,
            issue=issue,
            actor=actor,
        )

    mentioned = mentioned_user_ids(session, issue.team_id, issue.description)
    _raise(
        session,
        recipients=mentioned - assigned - {actor.id},
        kind=NotificationKind.mentioned,
        issue=issue,
        actor=actor,
    )


#: The fields whose movement is worth telling somebody about. Snapshotted
#: before an update the way `history.snapshot` is, and for the same reason:
#: a PATCH that sets a field to what it already held changed nothing, and
#: notifying on the payload rather than on the diff would say otherwise.
WATCHED_FIELDS = ("assignee_id", "status_id", "description")


def snapshot(issue: Issue) -> dict[str, object]:
    return {field: getattr(issue, field) for field in WATCHED_FIELDS}


def on_issue_updated(
    session: Session, issue: Issue, before: dict[str, object], actor: Optional[User]
) -> None:
    """Tell the new assignee, anyone newly named, and then the watchers.

    In that order, and each set subtracted from the next, so one PATCH is at
    most one notification per person.

    A null `actor` means an automation rule made the change. Nobody is
    subtracted in that case, deliberately: "nobody is notified about their own
    action" is about a person recognising what they just did, and an issue
    that moved on its own is the opposite of that.
    """
    assigned: set[int] = set()
    if issue.assignee_id != before.get("assignee_id") and issue.assignee_id:
        auto_watch(session, issue.id, issue.assignee_id)
        if actor is None or issue.assignee_id != actor.id:
            assigned = {issue.assignee_id}
            _raise(
                session,
                recipients=assigned,
                kind=NotificationKind.assigned,
                issue=issue,
                actor=actor,
            )

    mentioned: set[int] = set()
    if issue.description != before.get("description"):
        # Only handles that were not there before. Editing a typo in a
        # description should not re-ping everyone it names.
        was = mentioned_user_ids(session, issue.team_id, before.get("description"))
        mentioned = (
            mentioned_user_ids(session, issue.team_id, issue.description)
            - was
            - assigned
            - _own(actor)
        )
        _raise(
            session,
            recipients=mentioned,
            kind=NotificationKind.mentioned,
            issue=issue,
            actor=actor,
        )

    if issue.status_id != before.get("status_id"):
        _raise(
            session,
            recipients=watcher_ids(session, issue.id)
            - assigned
            - mentioned
            - _own(actor),
            kind=NotificationKind.status_changed,
            issue=issue,
            actor=actor,
        )


def on_comment_created(
    session: Session, issue: Issue, comment: Comment, actor: Optional[User]
) -> None:
    """A null `actor` is a comment an automation rule wrote -- see
    `Comment.author_id`. It watches nothing and excludes nobody."""
    if actor is not None:
        auto_watch(session, issue.id, actor.id)

    mentioned = mentioned_user_ids(session, issue.team_id, comment.body) - _own(actor)
    _raise(
        session,
        recipients=mentioned,
        kind=NotificationKind.mentioned,
        issue=issue,
        actor=actor,
        comment=comment,
    )
    _raise(
        session,
        recipients=watcher_ids(session, issue.id) - mentioned - _own(actor),
        kind=NotificationKind.commented,
        issue=issue,
        actor=actor,
        comment=comment,
    )


def delete_for_issue(session: Session, issue_id: int) -> None:
    """Drop the watches and notifications pointing at an issue being deleted.

    Both hold foreign keys to it (and to its comments), so this runs before
    the issue goes. There is nothing to keep: an inbox row whose issue no
    longer exists is a link to a 404.
    """
    for row in session.exec(
        select(Notification).where(Notification.issue_id == issue_id)
    ).all():
        session.delete(row)
    for row in session.exec(
        select(IssueWatch).where(IssueWatch.issue_id == issue_id)
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

    issues = {
        issue.id: issue
        for issue in session.exec(
            select(Issue).where(Issue.id.in_({row.issue_id for row in notifications}))
        ).all()
    }
    teams = {
        team.id: team
        for team in session.exec(
            select(Team).where(
                Team.id.in_({issue.team_id for issue in issues.values()})
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

    expanded = []
    for row in notifications:
        issue = issues.get(row.issue_id)
        team = teams.get(issue.team_id) if issue else None
        if issue is None or team is None:
            # Unreachable while `delete_for_issue` runs on every issue delete,
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
                issue=NotificationIssue(
                    id=issue.id,
                    team_id=issue.team_id,
                    team_key=team.key,
                    number=issue.number,
                    identifier=f"{team.key}-{issue.number}",
                    title=issue.title,
                ),
                actor=UserPublic.model_validate(actor) if actor else None,
                excerpt=excerpt(comment.body) if comment else None,
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
    filters = [Notification.user_id == current_user.id]
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
    if row is None or row.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Notification not found")

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


def get_settings(session: Session, current_user: User) -> NotificationSettings:
    from web import settings

    return NotificationSettings(
        email_notifications=current_user.email_notifications,
        email_delivery_configured=settings.email_delivery_configured,
    )


def update_settings(
    session: Session, current_user: User, email_notifications: bool
) -> NotificationSettings:
    current_user.email_notifications = email_notifications
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return get_settings(session, current_user)

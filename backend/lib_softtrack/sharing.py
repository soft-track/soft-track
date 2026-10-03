"""Read-only share links for an epic or a saved view (#245).

Showing a client how their project stands took an account: an invitation,
a password, a guest membership. A share link is the Monday-morning version:
a team admin makes one, sends it, and whoever has it sees a read-only page
without signing in -- each ticket's key, title, status and type, and the
epic's progress and target date. Comments, assignees, estimates and time
logged, and attachments are off unless the link turns them on.

**The token is the credential**, so it is treated like a password reset
token: unguessable, shown once, and only its sha256 kept. It can expire and
can ask for a password as well. Revoking keeps the row, so the team's list
still says who made a link and how often it was opened.

**One answer for every link that does not work.** Revoked, expired, pointing
at an epic or view that has gone, or never a link at all: `404
share_link_inactive`, saying nothing about what was behind it. Failed opens
and wrong passwords are throttled per address, and so, more loosely, is
opening at all (`lib_utils/rate_limit.py`).

**Nobody is signed in**, so nothing here is confined to anybody's epics
(`outside.py`) -- the link's own target is the whole of what it reaches --
but the trash still hides what is in it.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import case
from sqlmodel import Session, func, select

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.sharing import (
    ShareLinkCreate,
    ShareLinkCreated,
    ShareLinkRead,
    SharedAttachment,
    SharedComment,
    SharedPage,
    SharedStatus,
    SharedTicket,
    ShareShows,
)
from lib_softtrack.subtickets import progress_where
from lib_softtrack.tables import (
    Attachment,
    Comment,
    Project,
    SavedView,
    ShareLink,
    StatusCategory,
    Team,
    Ticket,
    User,
    WorkflowStatus,
    Worklog,
    utcnow,
)
from lib_softtrack.teams import get_team_or_404, require_team_admin
from lib_softtrack.tickets import due_clause, ticket_clauses
from lib_utils.errors import ErrorCode, api_error
from lib_utils.password import hash_password, verify_password
from lib_utils.rate_limit import share_failures_by_address, share_opens_by_address

#: How many tickets a page lists. An epic bigger than this is a backlog, not
#: something to show a client on a Monday; the page says how many more.
PAGE_LIMIT = 300

#: Open work first, the way a client reads it: what is moving, what is next,
#: then what is finished.
_CATEGORY_ORDER = {
    StatusCategory.started: 0,
    StatusCategory.unstarted: 1,
    StatusCategory.backlog: 2,
    StatusCategory.done: 3,
    StatusCategory.cancelled: 4,
}


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _aware(moment: Optional[datetime]) -> Optional[datetime]:
    """SQLite gives back naive datetimes; every one stored here is UTC."""
    if moment is not None and moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment


# --- What a link points at -------------------------------------------------


def _target(
    session: Session, link: ShareLink
) -> tuple[Optional[Project], Optional[SavedView]]:
    """The epic or the view, or (None, None) once it has gone. An epic in the
    trash has gone as far as a link is concerned: the trash hides it."""
    if link.project_id is not None:
        return session.get(Project, link.project_id), None
    if link.view_id is not None:
        return None, session.get(SavedView, link.view_id)
    return None, None


def _clauses(project: Optional[Project], view: Optional[SavedView]) -> list:
    """Which tickets the page lists: the epic's, or the view's filters."""
    if project is not None:
        return ticket_clauses(project.team_id, project_id=project.id)
    clauses = ticket_clauses(
        view.team_id,
        project_id=view.project_id,
        status_id=view.status_id,
        priority=view.priority,
        assignee_id=view.assignee_id,
        unassigned=view.unassigned,
        label_id=view.label_id,
        sprint_id=view.sprint_id,
    )
    if view.type is not None:
        clauses.append(Ticket.type == view.type)
    if view.due is not None:
        clauses.append(due_clause(view.due, datetime.now(timezone.utc).date()))
    return clauses


def _is_active(link: ShareLink, target_found: bool) -> bool:
    if link.revoked_at is not None or not target_found:
        return False
    expires = _aware(link.expires_at)
    return expires is None or expires > datetime.now(timezone.utc)


# --- The team's list -------------------------------------------------------


def _to_read(session: Session, link: ShareLink) -> ShareLinkRead:
    project, view = _target(session, link)
    target = project or view
    return ShareLinkRead(
        id=link.id,
        team_id=link.team_id,
        target_name=target.name if target is not None else None,
        kind="view" if link.view_id is not None or view is not None else "epic",
        project_id=link.project_id,
        view_id=link.view_id,
        created_by=UserPublic.model_validate(session.get(User, link.created_by_id)),
        created_at=link.created_at,
        expires_at=link.expires_at,
        revoked_at=link.revoked_at,
        has_password=link.password_hash is not None,
        shows=ShareShows(
            comments=link.show_comments,
            assignees=link.show_assignees,
            estimates=link.show_estimates,
            attachments=link.show_attachments,
        ),
        open_count=link.open_count,
        last_opened_at=link.last_opened_at,
        active=_is_active(link, target is not None),
    )


def create_link(
    session: Session, current_user: User, team_id: int, payload: ShareLinkCreate
) -> ShareLinkCreated:
    get_team_or_404(team_id, session)
    require_team_admin(team_id, current_user, session)

    if (payload.project_id is None) == (payload.view_id is None):
        raise api_error(
            status_code=400,
            code=ErrorCode.share_target_required,
            detail="A share link is for an epic or a saved view",
        )
    if payload.project_id is not None:
        project = session.get(Project, payload.project_id)
        if project is None or project.team_id != team_id:
            raise api_error(
                status_code=404,
                code=ErrorCode.project_not_found,
                detail="Epic not found",
            )
    else:
        view = session.get(SavedView, payload.view_id)
        # Shared with the team, or the admin's own: a private view of
        # somebody else's is not theirs to publish.
        if (
            view is None
            or view.team_id != team_id
            or not (view.is_shared or view.owner_id == current_user.id)
        ):
            raise api_error(
                status_code=404,
                code=ErrorCode.view_not_found,
                detail="View not found",
            )

    token = secrets.token_urlsafe(32)
    link = ShareLink(
        team_id=team_id,
        project_id=payload.project_id,
        view_id=payload.view_id,
        token_hash=_hash(token),
        created_by_id=current_user.id,
        expires_at=(
            utcnow() + timedelta(days=payload.expires_in_days)
            if payload.expires_in_days
            else None
        ),
        password_hash=hash_password(payload.password) if payload.password else None,
        show_comments=payload.shows.comments,
        show_assignees=payload.shows.assignees,
        show_estimates=payload.shows.estimates,
        show_attachments=payload.shows.attachments,
    )
    session.add(link)
    session.commit()
    session.refresh(link)
    return ShareLinkCreated(link=_to_read(session, link), token=token)


def list_links(
    session: Session, current_user: User, team_id: int
) -> list[ShareLinkRead]:
    get_team_or_404(team_id, session)
    require_team_admin(team_id, current_user, session)
    links = session.exec(
        select(ShareLink).where(ShareLink.team_id == team_id)
        # Working ones first, newest first; revoked ones after, for the record.
        .order_by(
            case((ShareLink.revoked_at.is_(None), 0), else_=1),
            ShareLink.created_at.desc(),
            ShareLink.id.desc(),
        )
    ).all()
    return [_to_read(session, link) for link in links]


def revoke_link(session: Session, current_user: User, share_link_id: int) -> None:
    link = session.get(ShareLink, share_link_id)
    if link is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.share_link_not_found,
            detail="Share link not found",
        )
    require_team_admin(link.team_id, current_user, session)
    if link.revoked_at is None:
        link.revoked_at = utcnow()
        session.add(link)
        session.commit()


def forget_epic(session: Session, project_id: int) -> None:
    """An epic purged from the trash takes its links with it: revoked, and no
    longer pointing at a row that is going."""
    _forget(session, ShareLink.project_id == project_id)


def forget_view(session: Session, view_id: int) -> None:
    """A deleted saved view takes its links with it, likewise."""
    _forget(session, ShareLink.view_id == view_id)


def _forget(session: Session, clause) -> None:
    for link in session.exec(select(ShareLink).where(clause)).all():
        link.project_id = None
        link.view_id = None
        link.revoked_at = link.revoked_at or utcnow()
        session.add(link)


# --- Opening one -----------------------------------------------------------


def _inactive():
    return api_error(
        status_code=404,
        code=ErrorCode.share_link_inactive,
        detail="This link is no longer active",
    )


def _open(
    session: Session, token: str, password: Optional[str], address: str
) -> tuple[ShareLink, Optional[Project], Optional[SavedView]]:
    """The link behind `token`, checked: active, and the password given if it
    asks for one. Every failure counts against the address."""
    share_opens_by_address.raise_if_locked(address)
    share_opens_by_address.record_attempt(address)
    share_failures_by_address.raise_if_locked(address)

    link = session.exec(
        select(ShareLink).where(ShareLink.token_hash == _hash(token))
    ).first()
    project, view = _target(session, link) if link is not None else (None, None)
    if link is None or not _is_active(link, project is not None or view is not None):
        share_failures_by_address.record_attempt(address)
        raise _inactive()

    if link.password_hash is not None:
        if not password:
            raise api_error(
                status_code=401,
                code=ErrorCode.share_password_required,
                detail="This link asks for a password",
            )
        if not verify_password(password, link.password_hash):
            share_failures_by_address.record_attempt(address)
            raise api_error(
                status_code=401,
                code=ErrorCode.share_password_wrong,
                detail="That is not the password for this link",
            )
    return link, project, view


def open_page(
    session: Session, token: str, password: Optional[str], address: str
) -> SharedPage:
    link, project, view = _open(session, token, password, address)
    clauses = _clauses(project, view)

    rows = session.exec(
        select(Ticket, WorkflowStatus)
        .join(WorkflowStatus, WorkflowStatus.id == Ticket.status_id)
        .where(*clauses)
        .order_by(
            case(
                *(
                    (WorkflowStatus.category == category, rank)
                    for category, rank in _CATEGORY_ORDER.items()
                ),
                else_=9,
            ),
            Ticket.number.desc(),
        )
        .limit(PAGE_LIMIT)
    ).all()
    matched = session.exec(
        select(func.count()).select_from(Ticket).where(*clauses)
    ).one()
    updated_at = session.exec(select(func.max(Ticket.updated_at)).where(*clauses)).one()
    done, total = progress_where(session, clauses)
    team = session.get(Team, link.team_id)

    tickets = _shared_tickets(session, link, team, rows)

    link.open_count += 1
    link.last_opened_at = utcnow()
    session.add(link)
    session.commit()

    target = project or view
    return SharedPage(
        team_name=team.name,
        kind="epic" if project is not None else "view",
        title=target.name,
        description=project.description if project is not None else None,
        color=project.color if project is not None else None,
        target_date=project.target_date if project is not None else None,
        ticket_count=total,
        completed_ticket_count=done,
        tickets=tickets,
        more=max(0, matched - len(tickets)),
        shows=ShareShows(
            comments=link.show_comments,
            assignees=link.show_assignees,
            estimates=link.show_estimates,
            attachments=link.show_attachments,
        ),
        updated_at=updated_at,
    )


def _shared_tickets(
    session: Session, link: ShareLink, team: Team, rows
) -> list[SharedTicket]:
    """The page's rows, with what the link shows and nothing else, in a
    query per kind of thing rather than per ticket."""
    ids = [ticket.id for ticket, _ in rows]
    people = {}
    if link.show_assignees or link.show_comments:
        wanted = {ticket.assignee_id for ticket, _ in rows if ticket.assignee_id}
        comments_by: dict[int, list[Comment]] = {}
        if link.show_comments and ids:
            for comment in session.exec(
                select(Comment)
                .where(Comment.ticket_id.in_(ids))
                .order_by(Comment.created_at, Comment.id)
            ).all():
                comments_by.setdefault(comment.ticket_id, []).append(comment)
                if comment.author_id:
                    wanted.add(comment.author_id)
        people = {
            user.id: user.full_name
            for user in session.exec(select(User).where(User.id.in_(wanted))).all()
        }
    logged = {}
    if link.show_estimates and ids:
        logged = dict(
            session.exec(
                select(Worklog.ticket_id, func.sum(Worklog.minutes))
                .where(Worklog.ticket_id.in_(ids))
                .group_by(Worklog.ticket_id)
            ).all()
        )
    files: dict[int, list[Attachment]] = {}
    if link.show_attachments and ids:
        for attachment in session.exec(
            select(Attachment)
            .where(Attachment.ticket_id.in_(ids), Attachment.guest_draft.is_(False))
            .order_by(Attachment.created_at, Attachment.id)
        ).all():
            files.setdefault(attachment.ticket_id, []).append(attachment)

    shared = []
    for ticket, status in rows:
        shared.append(
            SharedTicket(
                identifier=f"{team.key}-{ticket.number}",
                title=ticket.title,
                type=ticket.type,
                status=SharedStatus(
                    name=status.name, category=status.category, color=status.color
                ),
                assignee=(
                    people.get(ticket.assignee_id) if link.show_assignees else None
                ),
                estimate=ticket.estimate if link.show_estimates else None,
                minutes_logged=(
                    int(logged.get(ticket.id, 0)) if link.show_estimates else None
                ),
                comments=(
                    [
                        SharedComment(
                            author=people.get(comment.author_id),
                            body=comment.body,
                            created_at=comment.created_at,
                        )
                        for comment in comments_by.get(ticket.id, [])
                    ]
                    if link.show_comments
                    else None
                ),
                attachments=(
                    [
                        SharedAttachment(
                            id=attachment.id,
                            filename=attachment.filename,
                            content_type=attachment.content_type,
                            size_bytes=attachment.size_bytes,
                        )
                        for attachment in files.get(ticket.id, [])
                    ]
                    if link.show_attachments
                    else None
                ),
            )
        )
    return shared


def shared_attachment(
    session: Session,
    token: str,
    password: Optional[str],
    address: str,
    attachment_id: int,
) -> Attachment:
    """A file on a ticket the link shows, if the link shows files at all."""
    link, project, view = _open(session, token, password, address)
    attachment = (
        session.get(Attachment, attachment_id) if link.show_attachments else None
    )
    reachable = (
        attachment is not None
        and not attachment.guest_draft
        and session.exec(
            select(Ticket.id).where(
                Ticket.id == attachment.ticket_id, *_clauses(project, view)
            )
        ).first()
        is not None
    )
    if not reachable:
        raise api_error(
            status_code=404,
            code=ErrorCode.attachment_not_found,
            detail="Attachment not found",
        )
    return attachment

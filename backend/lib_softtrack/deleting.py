"""Deleting a ticket or an epic, and the trash that makes it undoable (#323).

Deleting moves a ticket or an epic to the trash: `deleted_at` and
`deleted_by_id` are set and nothing else changes, so restoring it brings back
its comments, links, attachments and history, and an epic's tickets rejoin
it. While it is in the trash, `lib_softtrack.trash` keeps it out of every
query. After `trash_retention_days` it is purged -- removed with everything
that pointed at it, attachment bytes included -- or sooner, by a team admin.

Who may delete is the team's to say: its admins and the ticket's creator (an
epic's lead), or with `any_member_may_delete`, anybody but a guest, which is
what deleting was before there was a trash.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlmodel import Session, func, select

from lib_identity.models.identity import UserPublic
from lib_softtrack import attachments as attachments_service
from lib_softtrack import automations as automations_service
from lib_softtrack import outbound, outside, sharing
from lib_softtrack import views as views_service
from lib_softtrack.history import record_changes, snapshot
from lib_softtrack.models.projects import ProjectRead
from lib_softtrack.models.tickets import TicketBulkDelete, TicketRead
from lib_softtrack.models.trash import Trash, TrashedEpic, TrashedTicket
from lib_softtrack.projects import project_to_read
from lib_softtrack.storage import Storage
from lib_softtrack.tables import (
    Project,
    Team,
    TeamRole,
    Ticket,
    TicketEvent,
    TicketEventField,
    User,
    WebhookEvent,
)
from lib_softtrack.teams import (
    get_team_or_404,
    require_team_admin,
    require_team_member,
    require_team_writer,
)
from lib_softtrack.tickets import (
    _delete_rows,
    _team_tickets_or_404,
    get_ticket_or_404,
    ticket_to_read,
)
from lib_softtrack.trash import INCLUDE_TRASHED, seeing_the_trash
from lib_utils.errors import ErrorCode, api_error

logger = logging.getLogger(__name__)


def retention() -> timedelta:
    from web import settings

    return timedelta(days=settings.trash_retention_days)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(moment: datetime) -> datetime:
    """SQLite hands datetimes back without their zone; they were written UTC."""
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


# --- who may ------------------------------------------------------------------


def _require_may_delete(
    session: Session, current_user: User, team_id: int, owner_id: Optional[int]
) -> None:
    """Refuse a delete the team's policy leaves to somebody else.

    `owner_id` is the ticket's creator, or the epic's lead. A guest never
    gets this far: the route's guard refuses them first.
    """
    membership = require_team_writer(team_id, current_user, session)
    if membership.role == TeamRole.admin or current_user.id == owner_id:
        return
    team = session.get(Team, team_id)
    if team.any_member_may_delete:
        return
    raise api_error(
        status_code=403,
        code=ErrorCode.not_allowed_to_delete,
        detail="On this team only its creator and the team's admins can delete it.",
    )


# --- tickets --------------------------------------------------------------------


def _record_trash(
    session: Session,
    ticket: Ticket,
    actor: User,
    old_value: Optional[str],
    new_value: Optional[str],
) -> None:
    session.add(
        TicketEvent(
            ticket_id=ticket.id,
            team_id=ticket.team_id,
            field=TicketEventField.trash,
            old_value=old_value,
            new_value=new_value,
            actor_id=actor.id,
        )
    )


def _trash_ticket(session: Session, current_user: User, ticket: Ticket) -> None:
    """Into the trash, without committing. Checked by the caller."""
    moment = _now()
    # The webhook body is the ticket as it was, read before it disappears
    # from every query including the one that would read it back.
    outbound.emit(
        session,
        ticket.team_id,
        WebhookEvent.ticket_deleted,
        lambda: {"ticket": ticket_to_read(ticket, session)},
        current_user,
    )
    _record_trash(session, ticket, current_user, None, moment.isoformat())
    ticket.deleted_at = moment
    ticket.deleted_by_id = current_user.id
    session.add(ticket)


def trash_ticket(session: Session, current_user: User, ticket_id: int) -> None:
    ticket = get_ticket_or_404(session, ticket_id)
    _require_may_delete(session, current_user, ticket.team_id, ticket.creator_id)
    _trash_ticket(session, current_user, ticket)
    session.commit()


def trash_tickets(
    session: Session, current_user: User, team_id: int, payload: TicketBulkDelete
) -> None:
    """Move many tickets to the trash, all of them or none.

    Every one is checked against the team's policy before any moves, so a
    batch holding one ticket its sender may not delete changes nothing.
    """
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    tickets = _team_tickets_or_404(session, team_id, payload.ticket_ids)
    for ticket in tickets:
        _require_may_delete(session, current_user, team_id, ticket.creator_id)
    for ticket in tickets:
        _trash_ticket(session, current_user, ticket)
    session.commit()


def _trashed_ticket_or_404(session: Session, ticket_id: int) -> Ticket:
    ticket = session.get(Ticket, ticket_id, execution_options=INCLUDE_TRASHED)
    if ticket is None:
        raise api_error(
            status_code=404, code=ErrorCode.ticket_not_found, detail="Ticket not found"
        )
    if ticket.deleted_at is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.not_in_trash,
            detail="That ticket is not in the trash",
        )
    return ticket


def restore_ticket(session: Session, current_user: User, ticket_id: int) -> TicketRead:
    """Out of the trash, as it was. Anybody on the team but a guest.

    A parent that has been purged since, or moved to another team, is let
    go of: the ticket comes back at the top level rather than under a
    ticket that is not there.
    """
    ticket = _trashed_ticket_or_404(session, ticket_id)
    require_team_writer(ticket.team_id, current_user, session)

    if ticket.parent_id is not None:
        parent = session.get(
            Ticket, ticket.parent_id, execution_options=INCLUDE_TRASHED
        )
        if parent is None or parent.team_id != ticket.team_id:
            before = snapshot(ticket)
            ticket.parent_id = None
            record_changes(session, ticket, before, current_user)

    _record_trash(
        session, ticket, current_user, _as_utc(ticket.deleted_at).isoformat(), None
    )
    ticket.deleted_at = None
    ticket.deleted_by_id = None
    session.add(ticket)
    session.flush()
    outbound.emit(
        session,
        ticket.team_id,
        WebhookEvent.ticket_restored,
        lambda: {"ticket": ticket_to_read(ticket, session)},
        current_user,
    )
    session.commit()
    session.refresh(ticket)
    return ticket_to_read(ticket, session)


def _purge_ticket(session: Session, ticket: Ticket) -> list[str]:
    """Remove a trashed ticket for good, without committing. Returns the
    attachment keys to purge from storage once the caller has committed."""
    with seeing_the_trash(session):
        return _delete_rows(session, ticket)


def purge_ticket(
    session: Session, current_user: User, ticket_id: int, storage: Storage
) -> None:
    """Delete forever, before the trash would. A team admin's."""
    ticket = _trashed_ticket_or_404(session, ticket_id)
    require_team_admin(ticket.team_id, current_user, session)
    keys = _purge_ticket(session, ticket)
    session.commit()
    attachments_service.purge(storage, keys)


# --- epics ----------------------------------------------------------------------


def trash_project(session: Session, current_user: User, project_id: int) -> None:
    """Move an epic to the trash. Its tickets keep pointing at it, so they
    rejoin it if it is restored; until then they show no epic."""
    project = session.get(Project, project_id)
    if project is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.project_not_found,
            detail="Project not found",
        )
    _require_may_delete(session, current_user, project.team_id, project.lead_id)
    project.deleted_at = _now()
    project.deleted_by_id = current_user.id
    session.add(project)
    session.commit()


def _trashed_project_or_404(session: Session, project_id: int) -> Project:
    project = session.get(Project, project_id, execution_options=INCLUDE_TRASHED)
    if project is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.project_not_found,
            detail="Project not found",
        )
    if project.deleted_at is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.not_in_trash,
            detail="That epic is not in the trash",
        )
    return project


def restore_project(
    session: Session, current_user: User, project_id: int
) -> ProjectRead:
    project = _trashed_project_or_404(session, project_id)
    require_team_writer(project.team_id, current_user, session)
    project.deleted_at = None
    project.deleted_by_id = None
    session.add(project)
    session.commit()
    session.refresh(project)
    return project_to_read(session, project)


def _purge_project(session: Session, project: Project, actor: Optional[User]) -> None:
    """Remove a trashed epic for good, without committing.

    Its tickets are released to no epic -- trashed ones too, or the row
    could not go -- each with a history entry, since the burn-up replays
    history and a ticket released silently would stay "in" the epic for
    ever. Saved views and rules that name it lose it, as they did when an
    epic was deleted outright.
    """
    with seeing_the_trash(session):
        now = _now()
        for ticket in session.exec(
            select(Ticket).where(Ticket.project_id == project.id)
        ).all():
            before = snapshot(ticket)
            ticket.project_id = None
            ticket.updated_at = now
            session.add(ticket)
            record_changes(session, ticket, before, actor)
        views_service.clear_project(session, project.id)
        automations_service.clear_project(session, project.id)
        # And guests from outside who were given it lose it (#243), and the
        # links that shared it stop working (#245).
        outside.forget_epic(session, project.id)
        sharing.forget_epic(session, project.id)
        session.flush()
        session.delete(project)


def purge_project(session: Session, current_user: User, project_id: int) -> None:
    project = _trashed_project_or_404(session, project_id)
    require_team_admin(project.team_id, current_user, session)
    _purge_project(session, project, current_user)
    session.commit()


# --- the trash ------------------------------------------------------------------


def _deleters(session: Session, ids: set[Optional[int]]) -> dict[int, UserPublic]:
    wanted = {user_id for user_id in ids if user_id is not None}
    if not wanted:
        return {}
    return {
        user.id: UserPublic.model_validate(user)
        for user in session.exec(select(User).where(User.id.in_(wanted))).all()
    }


def _trashed_ticket_read(
    ticket: Ticket, team: Team, deleters: dict[int, UserPublic]
) -> TrashedTicket:
    deleted_at = _as_utc(ticket.deleted_at)
    return TrashedTicket(
        id=ticket.id,
        team_id=ticket.team_id,
        number=ticket.number,
        identifier=f"{team.key}-{ticket.number}",
        title=ticket.title,
        type=ticket.type,
        deleted_at=deleted_at,
        deleted_by=deleters.get(ticket.deleted_by_id),
        purge_at=deleted_at + retention(),
    )


def list_trash(session: Session, current_user: User, team_id: int) -> Trash:
    team = get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    with seeing_the_trash(session):
        tickets = session.exec(
            select(Ticket)
            .where(Ticket.team_id == team_id, Ticket.deleted_at.is_not(None))
            .order_by(Ticket.deleted_at.desc())
        ).all()
        epics = session.exec(
            select(Project)
            .where(Project.team_id == team_id, Project.deleted_at.is_not(None))
            .order_by(Project.deleted_at.desc())
        ).all()
        counts = dict(
            session.exec(
                select(Ticket.project_id, func.count())
                .where(Ticket.project_id.in_([epic.id for epic in epics] or [0]))
                .group_by(Ticket.project_id)
            ).all()
        )
    deleters = _deleters(
        session,
        {ticket.deleted_by_id for ticket in tickets}
        | {epic.deleted_by_id for epic in epics},
    )
    return Trash(
        tickets=[_trashed_ticket_read(ticket, team, deleters) for ticket in tickets],
        epics=[
            TrashedEpic(
                id=epic.id,
                team_id=epic.team_id,
                name=epic.name,
                color=epic.color,
                ticket_count=counts.get(epic.id, 0),
                deleted_at=_as_utc(epic.deleted_at),
                deleted_by=deleters.get(epic.deleted_by_id),
                purge_at=_as_utc(epic.deleted_at) + retention(),
            )
            for epic in epics
        ],
        retention_days=retention().days,
    )


def trashed_ticket(
    session: Session, current_user: User, team_id: int, number: int
) -> TrashedTicket:
    """One ticket in the trash, by its number: what a link to it says."""
    team = get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    ticket = session.exec(
        select(Ticket)
        .where(Ticket.team_id == team_id, Ticket.number == number)
        .execution_options(**INCLUDE_TRASHED)
    ).one_or_none()
    if ticket is None or ticket.deleted_at is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.not_in_trash,
            detail="That ticket is not in the trash",
        )
    return _trashed_ticket_read(
        ticket, team, _deleters(session, {ticket.deleted_by_id})
    )


# --- purging what has been there long enough -------------------------------------


def purge_expired(
    session: Session, storage: Storage, now: Optional[datetime] = None
) -> int:
    """Purge everything deleted longer ago than the trash keeps it. Returns
    how many tickets and epics went."""
    cutoff = (now or _now()) - retention()
    with seeing_the_trash(session):
        tickets = session.exec(
            select(Ticket).where(
                Ticket.deleted_at.is_not(None), Ticket.deleted_at < cutoff
            )
        ).all()
        epics = session.exec(
            select(Project).where(
                Project.deleted_at.is_not(None), Project.deleted_at < cutoff
            )
        ).all()
    keys: list[str] = []
    for ticket in tickets:
        keys += _purge_ticket(session, ticket)
    for epic in epics:
        _purge_project(session, epic, actor=None)
    session.commit()
    attachments_service.purge(storage, keys)
    return len(tickets) + len(epics)


async def trash_loop(interval_seconds: float = 3600.0) -> None:
    """Purge the expired trash once an hour, forever, off any request.

    In-process like the digest and webhook loops, because the promise is
    `docker compose up`. A purge that runs twice at once is harmless: the
    second finds nothing left to take.
    """
    from lib_softtrack.storage import get_storage
    from web import engine

    def tick() -> None:
        with Session(engine) as session:
            purged = purge_expired(session, get_storage())
        if purged:
            logger.info("Purged %s tickets and epics from the trash", purged)

    while True:
        try:
            await asyncio.to_thread(tick)
        except Exception:
            logger.exception("The trash purge failed")
        await asyncio.sleep(interval_seconds)

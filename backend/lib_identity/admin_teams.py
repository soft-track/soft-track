"""Every team on the instance, for a site admin (#307).

A site admin is on the teams they joined, like anybody else, and could not
otherwise say how many teams there are, which are abandoned, or who runs the
one a new hire needs. Administration -> Teams lists them all as things to look
after: sizes, dates and names. Never their work: the ticket count is a number,
and reading a team's tickets still takes being on it.

From here a site admin appoints an admin -- a team always keeps an active one,
but that one can be on leave for a month -- archives and unarchives a team,
and deletes one with no tickets. Each is written to the server's log, in the
shape finance access is (`lib_finance/access.py`), until the audit log (#302)
records it.

The list is built in Python from five grouped queries, whatever the number of
teams. An instance has tens of teams, not tens of thousands, and "nothing in
thirty days" is a maximum over three tables that SQLite and Postgres spell
differently.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import delete, update
from sqlmodel import Session, col, func, select

from lib_identity.models.admin import AdminTeamFilter, AdminTeamRead
from lib_identity.models.identity import PersonRef
from lib_softtrack import outside
from lib_softtrack.models.page import DEFAULT_LIMIT, Page
from lib_softtrack.models.teams import TeamMemberRead
from lib_softtrack.tables import (
    AutomationRule,
    AutomationRun,
    CodeLink,
    Comment,
    CustomField,
    CustomFieldValue,
    GuestEpic,
    Label,
    Notification,
    OutboundWebhook,
    Project,
    Repository,
    SavedView,
    ShareLink,
    Sprint,
    ScheduleRun,
    SprintAction,
    SprintCapacity,
    Team,
    TeamInvite,
    TeamJoinRequest,
    TeamMember,
    TeamRequest,
    TeamRole,
    Ticket,
    TicketEvent,
    TicketSchedule,
    TicketTemplate,
    User,
    UserDefaultView,
    WebhookDelivery,
    WorkflowStatus,
    utcnow,
)
from lib_softtrack.teams import get_team_or_404, list_members_of
from lib_softtrack.trash import INCLUDE_TRASHED
from lib_utils.errors import ErrorCode, api_error

# "uvicorn.error" for the reason lib_finance/access.py gives: an INFO line
# from a module logger of our own would be swallowed.
logger = logging.getLogger("uvicorn.error")

#: How long without anything happening makes a team quiet.
QUIET_AFTER = timedelta(days=30)


def _as_utc(moment: datetime) -> datetime:
    """SQLite hands datetimes back without their zone; they were written UTC."""
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _record(event: str, actor: User, team: Team, **extra: str) -> None:
    """One line per change, read the same way in any log collector:

    team.archived at=2026-10-12T10:14:03Z by=sofia team=HCK
    """
    logger.info(
        "team.%s at=%s by=%s team=%s%s",
        event,
        utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        actor.username,
        team.key,
        "".join(f" {name}={value}" for name, value in extra.items()),
    )


def _latest(session: Session, statement) -> dict[int, datetime]:
    return {team_id: _as_utc(at) for team_id, at in session.exec(statement).all() if at}


def _reads(session: Session, teams: list[Team]) -> list[AdminTeamRead]:
    ids = [team.id for team in teams] or [0]
    members = dict(
        session.exec(
            select(TeamMember.team_id, func.count())
            .join(User, User.id == TeamMember.user_id)
            .where(
                col(TeamMember.team_id).in_(ids),
                User.is_active == True,  # noqa: E712 -- SQL comparison
            )
            .group_by(TeamMember.team_id)
        ).all()
    )
    admins: dict[int, list[PersonRef]] = {}
    for team_id, user in session.exec(
        select(TeamMember.team_id, User)
        .join(User, User.id == TeamMember.user_id)
        .where(
            col(TeamMember.team_id).in_(ids),
            TeamMember.role == TeamRole.admin,
            User.is_active == True,  # noqa: E712 -- SQL comparison
        )
        .order_by(TeamMember.joined_at, User.id)
    ).all():
        admins.setdefault(team_id, []).append(PersonRef.model_validate(user))
    # Outside the trash, which the session listener sees to.
    tickets = dict(
        session.exec(
            select(Ticket.team_id, func.count())
            .where(col(Ticket.team_id).in_(ids))
            .group_by(Ticket.team_id)
        ).all()
    )
    # The trash too: a team is deleted only with nothing left to purge.
    with_trash = dict(
        session.exec(
            select(Ticket.team_id, func.count())
            .where(col(Ticket.team_id).in_(ids))
            .group_by(Ticket.team_id)
            .execution_options(**INCLUDE_TRASHED)
        ).all()
    )
    changed = _latest(
        session,
        select(Ticket.team_id, func.max(Ticket.updated_at))
        .where(col(Ticket.team_id).in_(ids))
        .group_by(Ticket.team_id),
    )
    history = _latest(
        session,
        select(TicketEvent.team_id, func.max(TicketEvent.created_at))
        .where(col(TicketEvent.team_id).in_(ids))
        .group_by(TicketEvent.team_id),
    )
    commented = _latest(
        session,
        select(Ticket.team_id, func.max(Comment.created_at))
        .join(Ticket, Ticket.id == Comment.ticket_id)
        .where(col(Ticket.team_id).in_(ids))
        .group_by(Ticket.team_id),
    )

    quiet_before = utcnow() - QUIET_AFTER
    reads = []
    for team in teams:
        last = max(
            [_as_utc(team.created_at)]
            + [
                latest[team.id]
                for latest in (changed, history, commented)
                if team.id in latest
            ]
        )
        reads.append(
            AdminTeamRead(
                id=team.id,
                name=team.name,
                key=team.key,
                created_at=team.created_at,
                archived_at=team.archived_at,
                member_count=members.get(team.id, 0),
                admins=admins.get(team.id, []),
                ticket_count=tickets.get(team.id, 0),
                last_activity_at=last,
                quiet=team.archived_at is None and last < quiet_before,
                can_delete=with_trash.get(team.id, 0) == 0,
            )
        )
    return reads


def _matches(team: AdminTeamRead, which: Optional[AdminTeamFilter]) -> bool:
    if which is AdminTeamFilter.archived:
        return team.archived_at is not None
    if which is AdminTeamFilter.quiet:
        return team.quiet
    if which is AdminTeamFilter.one_admin:
        return team.archived_at is None and len(team.admins) <= 1
    return True


def list_teams(
    session: Session,
    q: Optional[str] = None,
    which: Optional[AdminTeamFilter] = None,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
) -> Page[AdminTeamRead]:
    statement = select(Team).order_by(func.lower(Team.name), Team.id)
    if q and q.strip():
        needle = f"%{q.strip()}%"
        statement = statement.where(
            col(Team.name).ilike(needle) | col(Team.key).ilike(needle)
        )
    rows = [
        team
        for team in _reads(session, session.exec(statement).all())
        if _matches(team, which)
    ]
    return Page(
        items=rows[offset : offset + limit],
        total=len(rows),
        limit=limit,
        offset=offset,
    )


def _read(session: Session, team: Team) -> AdminTeamRead:
    return _reads(session, [team])[0]


def list_members(session: Session, team_id: int) -> list[TeamMemberRead]:
    """Who is on a team and as what, for choosing its next admin. Names and
    roles, as the team's own roster shows them."""
    get_team_or_404(team_id, session)
    return list_members_of(session, team_id)


def appoint_admin(
    session: Session, actor: User, team_id: int, user_id: int
) -> AdminTeamRead:
    """Make somebody an admin of a team. On it already, they are promoted,
    from guest too; not on it, they join it as an admin."""
    team = get_team_or_404(team_id, session)
    user = session.get(User, user_id)
    if user is None:
        raise api_error(
            status_code=404, code=ErrorCode.user_not_found, detail="User not found"
        )
    if not user.is_active:
        raise api_error(
            status_code=400,
            code=ErrorCode.account_deactivated,
            detail="That account has been deactivated",
        )
    # Somebody from outside the organisation is only ever a guest (#243).
    outside.refuse_unless_guest(user, TeamRole.admin)

    membership = session.exec(
        select(TeamMember).where(
            TeamMember.team_id == team_id, TeamMember.user_id == user_id
        )
    ).first()
    if membership is not None and membership.role == TeamRole.admin:
        raise api_error(
            status_code=400,
            code=ErrorCode.already_team_admin,
            detail=f"{user.full_name} is an admin of {team.name} already",
        )
    was = membership.role.value if membership is not None else "none"
    if membership is None:
        membership = TeamMember(team_id=team_id, user_id=user_id, role=TeamRole.admin)
    else:
        membership.role = TeamRole.admin
    session.add(membership)
    session.commit()
    _record("admin_appointed", actor, team, user=user.username, was=was)
    return _read(session, team)


def set_archived(
    session: Session, actor: User, team_id: int, archived: bool
) -> AdminTeamRead:
    """Archive a team, or put it back. Asking for what it is already changes
    nothing and records nothing, so the date stays the day it was archived."""
    team = get_team_or_404(team_id, session)
    if (team.archived_at is not None) != archived:
        team.archived_at = utcnow() if archived else None
        session.add(team)
        session.commit()
        session.refresh(team)
        _record("archived" if archived else "unarchived", actor, team)
    return _read(session, team)


def delete_team(session: Session, actor: User, team_id: int) -> None:
    """Delete a team with no tickets, the trash included: the one made to try
    the product, or by mistake. A team with work in it is archived instead.

    Everything that belongs to it goes with it, children first so that no
    foreign key is left pointing at a removed row: its webhooks and their
    deliveries, rules and their runs, repositories, views and share links,
    epics, sprints, fields, labels, statuses, templates, invitations and
    memberships. A request for a team that approving created keeps its row,
    as the record of who asked; it just no longer names a team.
    """
    team = get_team_or_404(team_id, session)
    tickets = session.exec(
        select(func.count())
        .select_from(Ticket)
        .where(Ticket.team_id == team_id)
        .execution_options(**INCLUDE_TRASHED)
    ).one()
    if tickets:
        raise api_error(
            status_code=409,
            code=ErrorCode.team_not_empty,
            detail=f"{team.name} has tickets, so it can be archived and not deleted",
        )

    def of_team(table):
        return select(table.id).where(table.team_id == team_id).scalar_subquery()

    team.default_view_id = None
    session.add(team)
    session.flush()
    for statement in (
        delete(WebhookDelivery).where(
            col(WebhookDelivery.webhook_id).in_(of_team(OutboundWebhook))
        ),
        delete(OutboundWebhook).where(OutboundWebhook.team_id == team_id),
        delete(AutomationRun).where(AutomationRun.team_id == team_id),
        delete(AutomationRule).where(AutomationRule.team_id == team_id),
        delete(ScheduleRun).where(
            col(ScheduleRun.schedule_id).in_(of_team(TicketSchedule))
        ),
        delete(TicketSchedule).where(TicketSchedule.team_id == team_id),
        delete(CodeLink).where(col(CodeLink.repository_id).in_(of_team(Repository))),
        delete(Repository).where(Repository.team_id == team_id),
        delete(ShareLink).where(ShareLink.team_id == team_id),
        delete(UserDefaultView).where(UserDefaultView.team_id == team_id),
        delete(SavedView).where(SavedView.team_id == team_id),
        delete(GuestEpic).where(col(GuestEpic.project_id).in_(of_team(Project))),
        delete(SprintAction).where(col(SprintAction.sprint_id).in_(of_team(Sprint))),
        delete(SprintCapacity).where(
            col(SprintCapacity.sprint_id).in_(of_team(Sprint))
        ),
        delete(TicketEvent).where(TicketEvent.team_id == team_id),
        delete(Notification).where(
            col(Notification.custom_field_id).in_(of_team(CustomField))
        ),
        delete(CustomFieldValue).where(
            col(CustomFieldValue.field_id).in_(of_team(CustomField))
        ),
        delete(CustomField).where(CustomField.team_id == team_id),
        delete(Sprint).where(Sprint.team_id == team_id),
        delete(Project).where(Project.team_id == team_id),
        delete(Label).where(Label.team_id == team_id),
        delete(WorkflowStatus).where(WorkflowStatus.team_id == team_id),
        delete(TicketTemplate).where(TicketTemplate.team_id == team_id),
        delete(TeamInvite).where(TeamInvite.team_id == team_id),
        delete(TeamJoinRequest).where(TeamJoinRequest.team_id == team_id),
        delete(TeamMember).where(TeamMember.team_id == team_id),
        update(TeamRequest).where(TeamRequest.team_id == team_id).values(team_id=None),
    ):
        session.exec(statement)
    session.delete(team)
    session.commit()
    _record("deleted", actor, team)

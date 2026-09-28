"""Workload (#127): everything open assigned to one person, across the teams
the viewer shares with them.

It reads tickets, so it lives with the work rather than with identity, where
the profile it sits on lives. "Open" is the vocabulary every rollup uses: the
backlog, unstarted and started categories -- done and cancelled work is not
on anybody's plate.
"""

from typing import Optional

from sqlalchemy import case, func
from sqlmodel import Session, col, select

from lib_identity.models.identity import PersonRef
from lib_identity.models.people import SharedTeam
from lib_identity.people import find_by_username
from lib_softtrack.models.statuses import StatusRead
from lib_softtrack.models.workload import (
    ReportLoad,
    WorkloadRead,
    WorkloadTeam,
    WorkloadTicket,
)
from lib_softtrack.sprints import display_name
from lib_softtrack.statuses import in_category
from lib_softtrack.tables import (
    Sprint,
    StatusCategory,
    Team,
    TeamMember,
    Ticket,
    User,
    WorkflowStatus,
)
from lib_softtrack.tickets import PRIORITY_RANK
from lib_utils.errors import ErrorCode, api_error

OPEN = (StatusCategory.backlog, StatusCategory.unstarted, StatusCategory.started)

#: In flight first, then accepted, then the backlog: what is being done now
#: says most about somebody's week.
_CATEGORY_RANK = case(
    (WorkflowStatus.category == StatusCategory.started, 0),
    (WorkflowStatus.category == StatusCategory.unstarted, 1),
    else_=2,
)
_PRIORITY = case(
    *[(Ticket.priority == priority, rank) for priority, rank in PRIORITY_RANK.items()],
    else_=0,
)
_POINTS = func.coalesce(func.sum(Ticket.estimate), 0)


def _open_in_viewers_teams(viewer: User):
    """Open, and on a team the viewer belongs to -- the tenancy, in the query."""
    viewers_teams = select(TeamMember.team_id).where(TeamMember.user_id == viewer.id)
    return [in_category(*OPEN), col(Ticket.team_id).in_(viewers_teams)]


def workload(
    session: Session,
    viewer: User,
    username: str,
    per_team: int = 5,
    team_id: Optional[int] = None,
    offset: int = 0,
) -> WorkloadRead:
    person = find_by_username(session, username)
    if person is None:
        raise api_error(
            status_code=404, code=ErrorCode.user_not_found, detail="User not found"
        )
    visible = _open_in_viewers_teams(viewer)

    rollups = session.exec(
        select(Ticket.team_id, func.count(), _POINTS)
        .where(Ticket.assignee_id == person.id, *visible)
        .group_by(Ticket.team_id)
    ).all()
    teams = {
        team.id: team
        for team in session.exec(
            select(Team).where(col(Team.id).in_([row[0] for row in rollups] or [0]))
        ).all()
    }
    groups = sorted(rollups, key=lambda row: (teams[row[0]].name.lower(), row[0]))
    if team_id is not None:
        # One team's next page, for "Show more": each group pages on its own.
        groups = [row for row in groups if row[0] == team_id]

    return WorkloadRead(
        open_count=sum(int(count) for _, count, _ in rollups),
        points=sum(int(points) for _, _, points in rollups),
        teams=[
            WorkloadTeam(
                team=SharedTeam.model_validate(teams[group_team_id]),
                open_count=int(count),
                points=int(points),
                tickets=_page(
                    session,
                    person,
                    teams[group_team_id],
                    limit=per_team,
                    offset=offset if team_id is not None else 0,
                ),
                offset=offset if team_id is not None else 0,
                limit=per_team,
            )
            for group_team_id, count, points in groups
        ],
        reports=_report_loads(session, viewer, person) if team_id is None else [],
    )


def _page(
    session: Session, person: User, team: Team, limit: int, offset: int
) -> list[WorkloadTicket]:
    rows = session.exec(
        select(Ticket, WorkflowStatus, Sprint)
        .join(WorkflowStatus, WorkflowStatus.id == Ticket.status_id)
        .outerjoin(Sprint, Sprint.id == Ticket.sprint_id)
        .where(
            Ticket.assignee_id == person.id,
            Ticket.team_id == team.id,
            col(WorkflowStatus.category).in_(OPEN),
        )
        .order_by(_CATEGORY_RANK, _PRIORITY.desc(), Ticket.number.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return [
        WorkloadTicket(
            id=ticket.id,
            team_key=team.key,
            number=ticket.number,
            identifier=f"{team.key}-{ticket.number}",
            title=ticket.title,
            status=StatusRead.model_validate(status),
            priority=ticket.priority,
            estimate=ticket.estimate,
            sprint=display_name(sprint) if sprint else None,
        )
        for ticket, status, sprint in rows
    ]


def _report_loads(session: Session, viewer: User, person: User) -> list[ReportLoad]:
    """Each active direct report's open work, in one grouped query."""
    reports = session.exec(
        select(User)
        .where(User.manager_id == person.id, User.is_active == True)  # noqa: E712
        .order_by(func.lower(User.full_name), User.id)
    ).all()
    loads = {
        assignee_id: (int(count), int(points))
        for assignee_id, count, points in session.exec(
            select(Ticket.assignee_id, func.count(), _POINTS)
            .where(
                col(Ticket.assignee_id).in_([report.id for report in reports] or [0]),
                *_open_in_viewers_teams(viewer),
            )
            .group_by(Ticket.assignee_id)
        ).all()
    }
    return [
        ReportLoad(
            person=PersonRef.model_validate(report),
            open_count=loads.get(report.id, (0, 0))[0],
            points=loads.get(report.id, (0, 0))[1],
        )
        for report in reports
    ]

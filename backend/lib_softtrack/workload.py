"""Workload (#127): everything open assigned to one person, across the teams
the viewer shares with them.

It reads tickets, so it lives with the work rather than with identity, where
the profile it sits on lives. "Open" is the vocabulary every rollup uses: the
backlog, unstarted and started categories -- done and cancelled work is not
on anybody's plate.
"""

from typing import Optional

from sqlalchemy import case, func, literal
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
#: says most about somebody's week. My work (#258) sorts by it too.
CATEGORY_RANK = case(
    (WorkflowStatus.category == StatusCategory.started, 0),
    (WorkflowStatus.category == StatusCategory.unstarted, 1),
    else_=2,
)
PRIORITY = case(
    *[(Ticket.priority == priority, rank) for priority, rank in PRIORITY_RANK.items()],
    else_=0,
)
_POINTS = func.coalesce(func.sum(Ticket.estimate), 0)


def open_in_viewers_teams(viewer: User, archived: bool = True) -> list:
    """Open, and on a team the viewer belongs to -- the tenancy, in the query.

    `archived=False` leaves out the teams a site admin archived (#307): My
    work (#258) is what to do today, and nothing is done on an archived team.
    """
    viewers_teams = select(TeamMember.team_id).where(TeamMember.user_id == viewer.id)
    if not archived:
        viewers_teams = viewers_teams.join(Team, Team.id == TeamMember.team_id).where(
            Team.archived_at == None  # noqa: E711 -- SQL IS NULL
        )
    return [in_category(*OPEN), col(Ticket.team_id).in_(viewers_teams)]


def team_rollups(
    session: Session, *where, pulled=None
) -> list[tuple[int, int, int, int]]:
    """`(team_id, count, points, pulled)` per team for the tickets matching
    `where`, counted and summed by the database: the workload's totals, and
    My work's (#258). `pulled` counts the rows matching a further condition
    -- the ones My work lifts out of their team into "due soon" -- and is 0
    without one."""
    pulled_count = (
        func.coalesce(func.sum(case((pulled, 1), else_=0)), 0)
        if pulled is not None
        else literal(0)
    )
    return [
        (team_id, int(count), int(points), int(lifted))
        for team_id, count, points, lifted in session.exec(
            select(Ticket.team_id, func.count(), _POINTS, pulled_count)
            .where(*where)
            .group_by(Ticket.team_id)
        ).all()
    ]


def teams_by_id(session: Session, team_ids) -> dict[int, Team]:
    return {
        team.id: team
        for team in session.exec(
            select(Team).where(col(Team.id).in_(list(team_ids) or [0]))
        ).all()
    }


def by_team_name(rollups: list[tuple], teams: dict[int, Team]) -> list[tuple]:
    """Groups in the order the teams are named, as every team list is."""
    return sorted(rollups, key=lambda row: (teams[row[0]].name.lower(), row[0]))


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
    visible = open_in_viewers_teams(viewer)

    rollups = team_rollups(session, Ticket.assignee_id == person.id, *visible)
    teams = teams_by_id(session, (row[0] for row in rollups))
    groups = by_team_name(rollups, teams)
    if team_id is not None:
        # One team's next page, for "Show more": each group pages on its own.
        groups = [row for row in groups if row[0] == team_id]

    return WorkloadRead(
        open_count=sum(count for _, count, _, _ in rollups),
        points=sum(points for _, _, points, _ in rollups),
        teams=[
            WorkloadTeam(
                team=SharedTeam.model_validate(teams[group_team_id]),
                open_count=count,
                points=points,
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
            for group_team_id, count, points, _ in groups
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
        .order_by(CATEGORY_RANK, PRIORITY.desc(), Ticket.number.desc())
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
                *open_in_viewers_teams(viewer),
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

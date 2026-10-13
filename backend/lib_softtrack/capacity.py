"""Sprint capacity (#269): what each person can take, against what they have.

**Capacity starts from the team's default.** Points for a whole sprint
(`Team.capacity_points`), and minutes for each working day
(`Team.capacity_minutes_per_day`). A person who is away some of the sprint's
working days has the points in proportion and the hours for the days they
are here. For one sprint, somebody can set a person's capacity by hand in
either unit; that replaces the default in that unit and nothing else.

**Working days** are the weekdays from the sprint's first day to its last.
The days somebody is away are entered by hand for now (`SprintCapacity`);
approved leave (#248) and public holidays (#250) will feed them when they
exist.

**Who has a row.** Everybody on the team who can be assigned its work: not a
guest, and not a deactivated account. Tickets in the sprint assigned to
anybody else -- somebody who left with finished work still in their name --
are counted in the scope and in a row of their own, so the scope adds up.

The plan is never a gate. Over capacity is shown, and assigning carries on;
nothing here assigns or levels anything.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func
from sqlmodel import Session, col, select

from lib_identity.models.identity import PersonRef
from lib_identity.models.people import SharedTeam
from lib_softtrack import reports as reports_service
from lib_softtrack import time_estimates
from lib_softtrack.models.capacity import (
    CapacityUpdate,
    DeliveredSprint,
    PersonCapacity,
    PlanSprint,
    SprintLoad,
    SprintPlan,
    TeamCapacity,
)
from lib_softtrack.sprints import display_name, get_sprint_or_404
from lib_softtrack.statuses import in_category
from lib_softtrack.tables import (
    EstimateUnit,
    Sprint,
    SprintCapacity,
    SprintState,
    StatusCategory,
    Team,
    TeamMember,
    TeamRole,
    Ticket,
    User,
)
from lib_softtrack.teams import (
    get_team_or_404,
    require_assignable,
    require_team_member,
)
from lib_utils.errors import ErrorCode, api_error

#: How many completed sprints the suggestion averages.
HISTORY = 3


def _as_utc_date(value: datetime, end: bool = False) -> date:
    # SQLite hands back naive datetimes, in UTC; Postgres aware ones.
    moment = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    # A sprint that ends at midnight ended the day before: 14 Oct 00:00 is the
    # end of the 13th. One that ends at 23:59:59 ends that day.
    if end:
        moment -= timedelta(microseconds=1)
    return moment.date()


def working_days(sprint: Sprint) -> int:
    """The weekdays from the sprint's first day to its last, both counted."""
    first = _as_utc_date(sprint.starts_at)
    last = _as_utc_date(sprint.ends_at, end=True)
    days = 0
    day = first
    while day <= last:
        if day.weekday() < 5:
            days += 1
        day += timedelta(days=1)
    return days


def default_points(team: Team, days_here: int, days: int) -> int:
    """The team's points for a whole sprint, in proportion to the days here,
    rounded half up."""
    if days <= 0:
        return 0
    return (2 * team.capacity_points * days_here + days) // (2 * days)


def planning_sprint(session: Session, team_id: int) -> Optional[Sprint]:
    """The sprint a team is planning: the next one to start, or the one under
    way when none is lined up."""
    upcoming = session.exec(
        select(Sprint)
        .where(Sprint.team_id == team_id, Sprint.state == SprintState.upcoming)
        .order_by(Sprint.number)
    ).first()
    if upcoming is not None:
        return upcoming
    return session.exec(
        select(Sprint).where(
            Sprint.team_id == team_id, Sprint.state == SprintState.active
        )
    ).first()


def _people(session: Session, team_id: int) -> list[User]:
    """Who has a capacity on the team: members and admins with active
    accounts, by name."""
    return list(
        session.exec(
            select(User)
            .join(TeamMember, TeamMember.user_id == User.id)
            .where(
                TeamMember.team_id == team_id,
                TeamMember.role != TeamRole.guest,
                User.is_active == True,  # noqa: E712 -- SQL boolean
            )
            .order_by(func.lower(User.full_name), User.id)
        ).all()
    )


def _rows(session: Session, sprint: Sprint, team: Team, people: list[User]):
    """Each person's capacity row, and the loads of everybody else."""
    days = working_days(sprint)
    settings = {
        row.user_id: row
        for row in session.exec(
            select(SprintCapacity).where(SprintCapacity.sprint_id == sprint.id)
        ).all()
    }
    points = {
        assignee: (int(count), int(total))
        for assignee, count, total in session.exec(
            select(
                Ticket.assignee_id,
                func.count(),
                func.coalesce(func.sum(Ticket.estimate), 0),
            )
            .where(Ticket.sprint_id == sprint.id)
            .group_by(Ticket.assignee_id)
        ).all()
    }
    minutes = {
        assignee: totals.estimated_minutes
        for assignee, totals in time_estimates.totals_by(
            session,
            Ticket.assignee_id,
            time_estimates.in_with_subtickets(Ticket.sprint_id, sprint.id),
        ).items()
    }

    rows = []
    for person in people:
        setting = settings.get(person.id)
        days_off = min(setting.days_off if setting else 0, days)
        days_here = days - days_off
        count, assigned = points.get(person.id, (0, 0))
        set_points = setting.points if setting else None
        set_minutes = setting.minutes if setting else None
        rows.append(
            PersonCapacity(
                person=PersonRef.model_validate(person),
                days_here=days_here,
                days_off=days_off,
                tickets=count,
                points_assigned=assigned,
                points_capacity=(
                    set_points
                    if set_points is not None
                    else default_points(team, days_here, days)
                ),
                points_set=set_points is not None,
                minutes_assigned=minutes.get(person.id, 0),
                minutes_capacity=(
                    set_minutes
                    if set_minutes is not None
                    else team.capacity_minutes_per_day * days_here
                ),
                minutes_set=set_minutes is not None,
            )
        )

    with_rows = {person.id for person in people}
    unassigned = SprintLoad(
        tickets=points.get(None, (0, 0))[0],
        points=points.get(None, (0, 0))[1],
        minutes=minutes.get(None, 0),
    )
    others = [key for key in set(points) | set(minutes) if key not in with_rows]
    elsewhere = SprintLoad(
        tickets=sum(points.get(key, (0, 0))[0] for key in others if key is not None),
        points=sum(points.get(key, (0, 0))[1] for key in others if key is not None),
        minutes=sum(minutes.get(key, 0) for key in others if key is not None),
    )
    return days, rows, unassigned, elsewhere


def _history(
    session: Session, current_user: User, team_id: int
) -> list[DeliveredSprint]:
    velocity = reports_service.velocity(session, current_user, team_id, HISTORY)
    ids = [row.sprint_id for row in velocity.sprints]
    delivered_minutes = (
        time_estimates.totals_by(
            session,
            Ticket.sprint_id,
            col(Ticket.sprint_id).in_(ids),
            in_category(StatusCategory.done),
        )
        if ids
        else {}
    )
    return [
        DeliveredSprint(
            sprint_id=row.sprint_id,
            display_name=row.sprint_name,
            points_planned=row.points_committed,
            points_delivered=row.points_completed,
            minutes_delivered=(
                delivered_minutes[row.sprint_id].estimated_minutes
                if row.sprint_id in delivered_minutes
                else 0
            ),
        )
        for row in velocity.sprints
    ]


def _average(values: list[int]) -> Optional[int]:
    if not values:
        return None
    # Half up, as people round: 36.5 is 37.
    return int(sum(values) / len(values) + 0.5)


def sprint_plan(session: Session, current_user: User, sprint_id: int) -> SprintPlan:
    sprint = get_sprint_or_404(session, sprint_id)
    require_team_member(sprint.team_id, current_user, session)
    team = get_team_or_404(sprint.team_id, session)

    days, rows, unassigned, elsewhere = _rows(
        session, sprint, team, _people(session, team.id)
    )
    history = _history(session, current_user, team.id)
    return SprintPlan(
        sprint=PlanSprint(
            id=sprint.id,
            display_name=display_name(sprint),
            starts_at=sprint.starts_at,
            ends_at=sprint.ends_at,
            state=sprint.state,
        ),
        estimate_unit=team.estimate_unit,
        working_days=days,
        default_points=team.capacity_points,
        default_minutes_per_day=team.capacity_minutes_per_day,
        people=rows,
        unassigned=unassigned,
        elsewhere=elsewhere,
        scope_points=sum(row.points_assigned for row in rows)
        + unassigned.points
        + elsewhere.points,
        capacity_points=sum(row.points_capacity for row in rows),
        scope_minutes=sum(row.minutes_assigned for row in rows)
        + unassigned.minutes
        + elsewhere.minutes,
        capacity_minutes=sum(row.minutes_capacity for row in rows),
        history=history,
        average_points=_average([row.points_delivered for row in history]),
        average_minutes=_average([row.minutes_delivered for row in history]),
    )


def set_capacity(
    session: Session, current_user: User, sprint_id: int, payload: CapacityUpdate
) -> SprintPlan:
    """Change people's capacity in one sprint. Only the fields sent change; a
    capacity sent as null goes back to the team's default."""
    sprint = get_sprint_or_404(session, sprint_id)
    require_team_member(sprint.team_id, current_user, session)
    if sprint.state is SprintState.completed:
        raise api_error(
            status_code=409,
            code=ErrorCode.sprint_completed,
            detail="A completed sprint cannot be changed; its numbers are history.",
        )

    for change in payload.people:
        # A guest or a stranger has no capacity to set: the same refusal as
        # assigning them a ticket.
        require_assignable(sprint.team_id, change.user_id, session)
        row = session.get(SprintCapacity, (sprint.id, change.user_id))
        if row is None:
            row = SprintCapacity(sprint_id=sprint.id, user_id=change.user_id)
        sent = change.model_fields_set
        if "days_off" in sent:
            row.days_off = change.days_off or 0
        if "points" in sent:
            row.points = change.points
        if "minutes" in sent:
            row.minutes = change.minutes
        session.add(row)
    session.commit()
    return sprint_plan(session, current_user, sprint_id)


def across_teams(
    session: Session, person: User, team_ids: list[int]
) -> list[TeamCapacity]:
    """Somebody's capacity on each of `team_ids` they can be assigned work
    on, in the sprint each is planning (#269), in the order the teams are
    named. A team with no sprint lined up has nothing to show."""
    teams = session.exec(
        select(Team)
        .join(TeamMember, TeamMember.team_id == Team.id)
        .where(
            col(Team.id).in_(team_ids or [0]),
            TeamMember.user_id == person.id,
            TeamMember.role != TeamRole.guest,
            Team.archived_at == None,  # noqa: E711 -- SQL IS NULL
        )
        .order_by(func.lower(Team.name), Team.id)
    ).all()
    found = []
    for team in teams:
        sprint = planning_sprint(session, team.id)
        if sprint is None:
            continue
        _, rows, _, _ = _rows(session, sprint, team, [person])
        row = rows[0]
        found.append(
            TeamCapacity(
                team=SharedTeam.model_validate(team),
                sprint_id=sprint.id,
                sprint=display_name(sprint),
                unit=(
                    EstimateUnit.hours
                    if team.estimate_unit is EstimateUnit.hours
                    else EstimateUnit.points
                ),
                points_assigned=row.points_assigned,
                points_capacity=row.points_capacity,
                minutes_assigned=row.minutes_assigned,
                minutes_capacity=row.minutes_capacity,
            )
        )
    return found

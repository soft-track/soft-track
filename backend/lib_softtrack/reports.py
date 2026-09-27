"""Charts, reconstructed from issue history.

Every report here answers a question about the past -- "how many points were
outstanding on the ninth?" -- and no query over the current rows can answer
that. The `issueevent` table is the only source, and the shape of the work is
always the same: take the events, replay them up to the end of each day, and
count what the board looked like then.

`_timeline` does that replay once and everything else reads from it.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Optional

from sqlalchemy import or_
from sqlmodel import Session, select

from lib_softtrack.sprints import get_sprint_or_404
from lib_softtrack.models.worklogs import TimeSpent
from lib_softtrack.models.reports import (
    Burndown,
    BurndownPoint,
    CreatedResolvedPoint,
    CreatedVsResolved,
    CumulativeFlow,
    FlowPoint,
    ProjectBurnup,
    ProjectBurnupPoint,
    ScopeChange,
    Velocity,
    VelocitySprint,
)
from lib_softtrack.projects import get_project_or_404
from lib_softtrack.statuses import in_category
from lib_softtrack.tables import (
    Sprint,
    SprintState,
    Issue,
    IssueEvent,
    IssueEventField,
    StatusCategory,
    User,
    Worklog,
)
from lib_softtrack.teams import get_team_or_404, require_team_member

#: Categories that take an issue off the burndown.
#:
#: Every report here reads categories rather than statuses, and the history it
#: replays stores categories too -- see `_status_category` in history.py. That
#: is what keeps a chart of the past meaningful after a team renames a column,
#: adds one, or deletes one and moves the work.
RESOLVED = (StatusCategory.done, StatusCategory.cancelled)
#: Only `done` counts as delivered. Cancelled work left the sprint without
#: being finished, so counting it as completed would flatter every chart.
DELIVERED = StatusCategory.done


def _end_of(day: date) -> datetime:
    return datetime.combine(day, datetime.max.time(), tzinfo=timezone.utc)


def _as_utc(value: datetime) -> datetime:
    """SQLite hands back naive datetimes; Postgres does not. Normalise."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _days_between(start: date, end: date) -> list[date]:
    return [start + timedelta(days=offset) for offset in range((end - start).days + 1)]


class _Timeline:
    """The value of one tracked field, per issue, over time.

    Built once from the event rows and then asked `value_at` repeatedly, which
    keeps every report to a single pass over the history rather than a query
    per day.
    """

    def __init__(self, events: Iterable[IssueEvent]):
        self._by_issue: dict[int, list[tuple[datetime, Optional[str]]]] = defaultdict(
            list
        )
        for event in events:
            self._by_issue[event.issue_id].append(
                (_as_utc(event.created_at), event.new_value)
            )
        for entries in self._by_issue.values():
            entries.sort(key=lambda entry: entry[0])

    @property
    def issue_ids(self) -> set[int]:
        return set(self._by_issue)

    def value_at(self, issue_id: int, moment: datetime) -> Optional[str]:
        """The last value set at or before `moment`, or None if never set."""
        current = None
        for when, value in self._by_issue.get(issue_id, ()):
            if when > moment:
                break
            current = value
        return current


def _timelines(
    session: Session, issue_ids: set[int]
) -> tuple[_Timeline, _Timeline, _Timeline]:
    if not issue_ids:
        empty: list[IssueEvent] = []
        return _Timeline(empty), _Timeline(empty), _Timeline(empty)

    events = session.exec(
        select(IssueEvent)
        .where(IssueEvent.issue_id.in_(issue_ids))
        .order_by(IssueEvent.created_at)
    ).all()

    def of(field: IssueEventField) -> _Timeline:
        return _Timeline(event for event in events if event.field is field)

    return (
        of(IssueEventField.status),
        of(IssueEventField.sprint),
        of(IssueEventField.estimate),
    )


# --- burndown -----------------------------------------------------------


def burndown(session: Session, current_user: User, sprint_id: int) -> Burndown:
    sprint = get_sprint_or_404(session, sprint_id)
    require_team_member(sprint.team_id, current_user, session)

    # Every issue that was ever in this sprint, not just the ones in it now --
    # work that was pulled out mid-sprint still shaped the line while it was in.
    ever_in = {
        event.issue_id
        for event in session.exec(
            select(IssueEvent).where(
                IssueEvent.field == IssueEventField.sprint,
                IssueEvent.new_value == str(sprint_id),
            )
        ).all()
    }
    ever_in |= {
        issue.id
        for issue in session.exec(
            select(Issue).where(Issue.sprint_id == sprint_id)
        ).all()
    }

    status_at, sprint_at, estimate_at = _timelines(session, ever_in)

    start = _as_utc(sprint.starts_at).date()
    end = _as_utc(sprint.ends_at).date()
    today = datetime.now(timezone.utc).date()
    # Never chart the future: a line running flat to the end of the sprint
    # reads as "nothing is happening" rather than "this has not happened yet".
    last = min(end, today) if sprint.state != SprintState.completed else end

    points: list[BurndownPoint] = []
    scope_changes: list[ScopeChange] = []
    opening_total: Optional[int] = None
    previous: Optional[tuple[set[int], int]] = None
    span = max((end - start).days, 1)

    for offset, day in enumerate(_days_between(start, max(last, start))):
        moment = _end_of(day)
        in_sprint: set[int] = set()
        total = remaining = completed = issues_remaining = 0

        for issue_id in ever_in:
            if sprint_at.value_at(issue_id, moment) != str(sprint_id):
                continue
            in_sprint.add(issue_id)

            raw_estimate = estimate_at.value_at(issue_id, moment)
            estimate = int(raw_estimate) if raw_estimate else 0
            status = status_at.value_at(issue_id, moment)

            total += estimate
            if status == DELIVERED.value:
                completed += estimate
            elif status not in {category.value for category in RESOLVED}:
                remaining += estimate
                issues_remaining += 1

        if opening_total is None:
            opening_total = total

        points.append(
            BurndownPoint(
                day=day,
                points_remaining=remaining,
                issues_remaining=issues_remaining,
                points_completed=completed,
                points_total=total,
                # Straight from the opening scope to zero across the planned
                # span, not the current scope -- otherwise adding work would
                # quietly move the goalposts and the line would always look on
                # track.
                ideal_remaining=round(max(opening_total * (1 - offset / span), 0.0), 2),
            )
        )

        if previous is not None:
            before_ids, before_points = previous
            added, removed = in_sprint - before_ids, before_ids - in_sprint
            if added or removed:
                scope_changes.append(
                    ScopeChange(
                        day=day,
                        issues_added=len(added),
                        issues_removed=len(removed),
                        points_added=max(total - before_points, 0),
                        points_removed=max(before_points - total, 0),
                    )
                )
        previous = (in_sprint, total)

    return Burndown(
        sprint_id=sprint.id,
        sprint_name=sprint.name or f"Sprint {sprint.number}",
        starts_at=start,
        ends_at=end,
        points=points,
        scope_changes=scope_changes,
    )


# --- project burnup -----------------------------------------------------


def project_burnup(
    session: Session, current_user: User, project_id: int
) -> ProjectBurnup:
    """Scope against completed work, per day, for one project (#64).

    A burnup rather than a burndown because an epic's scope is expected to
    move: the gap between the two lines is what is left, and a rising top line
    is scope added after work started -- the thing that explains most missed
    dates, and the thing a burndown hides.

    Replayed from `issueevent` like every other report. Issues count while
    their project event says they were in this project, so one moved out
    mid-way stops counting from that day. The chart starts on the first day
    history mentions the project and runs to today.
    """
    project = get_project_or_404(session, project_id)
    require_team_member(project.team_id, current_user, session)
    key = str(project_id)

    mentions = session.exec(
        select(IssueEvent).where(
            IssueEvent.field == IssueEventField.project,
            or_(IssueEvent.new_value == key, IssueEvent.old_value == key),
        )
    ).all()
    if not mentions:
        return ProjectBurnup(
            project_id=project.id, project_name=project.name, points=[]
        )

    ever_in = {event.issue_id for event in mentions}
    events = session.exec(
        select(IssueEvent)
        .where(IssueEvent.issue_id.in_(ever_in))
        .order_by(IssueEvent.created_at)
    ).all()

    def of(field: IssueEventField) -> _Timeline:
        return _Timeline(event for event in events if event.field is field)

    status_at, project_at, estimate_at = (
        of(IssueEventField.status),
        of(IssueEventField.project),
        of(IssueEventField.estimate),
    )

    start = min(_as_utc(event.created_at) for event in mentions).date()
    # Never chart the future, for the reason the burndown gives.
    today = datetime.now(timezone.utc).date()

    points: list[ProjectBurnupPoint] = []
    for day in _days_between(start, max(today, start)):
        moment = _end_of(day)
        scope_issues = completed_issues = scope_points = completed_points = 0
        unestimated = 0

        for issue_id in ever_in:
            if project_at.value_at(issue_id, moment) != key:
                continue
            status = status_at.value_at(issue_id, moment)
            if status == StatusCategory.cancelled.value:
                continue
            raw_estimate = estimate_at.value_at(issue_id, moment)
            estimate = int(raw_estimate) if raw_estimate else None

            scope_issues += 1
            if estimate is None:
                unestimated += 1
            else:
                scope_points += estimate
            if status == DELIVERED.value:
                completed_issues += 1
                completed_points += estimate or 0

        points.append(
            ProjectBurnupPoint(
                day=day,
                scope_issues=scope_issues,
                completed_issues=completed_issues,
                scope_points=scope_points,
                completed_points=completed_points,
                unestimated_issues=unestimated,
            )
        )

    return ProjectBurnup(
        project_id=project.id,
        project_name=project.name,
        started_on=start,
        points=points,
    )


# --- velocity -----------------------------------------------------------


def velocity(
    session: Session, current_user: User, team_id: int, limit: int = 6
) -> Velocity:
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)

    completed_sprints = session.exec(
        select(Sprint)
        .where(Sprint.team_id == team_id, Sprint.state == SprintState.completed)
        .order_by(Sprint.number.desc())
        .limit(limit)
    ).all()
    completed_sprints = list(reversed(completed_sprints))

    rows: list[VelocitySprint] = []
    for sprint in completed_sprints:
        issues = session.exec(select(Issue).where(Issue.sprint_id == sprint.id)).all()
        delivered_ids = {
            issue_id
            for issue_id in session.exec(
                select(Issue.id).where(
                    Issue.sprint_id == sprint.id, in_category(DELIVERED)
                )
            ).all()
        }
        delivered = [issue for issue in issues if issue.id in delivered_ids]

        # Committed is the scope at the moment the sprint started, not what it
        # ended with. A team that finished everything it added late did not
        # commit to it.
        _, sprint_at, estimate_at = _timelines(
            session,
            {issue.id for issue in issues} | _ever_in_sprint(session, sprint.id),
        )
        opened = _end_of(_as_utc(sprint.starts_at).date())
        committed = 0
        for issue_id in sprint_at.issue_ids:
            if sprint_at.value_at(issue_id, opened) != str(sprint.id):
                continue
            raw = estimate_at.value_at(issue_id, opened)
            committed += int(raw) if raw else 0

        rows.append(
            VelocitySprint(
                sprint_id=sprint.id,
                sprint_name=sprint.name or f"Sprint {sprint.number}",
                completed_at=(
                    _as_utc(sprint.completed_at).date() if sprint.completed_at else None
                ),
                points_committed=committed,
                points_completed=sum(issue.estimate or 0 for issue in delivered),
                issues_completed=len(delivered),
            )
        )

    return Velocity(
        sprints=rows,
        # None rather than 0 for an empty history: zero reads as "this team
        # delivers nothing", which is a different and much worse claim.
        average_points=(
            round(sum(row.points_completed for row in rows) / len(rows), 1)
            if rows
            else None
        ),
    )


def _ever_in_sprint(session: Session, sprint_id: int) -> set[int]:
    return {
        event.issue_id
        for event in session.exec(
            select(IssueEvent).where(
                IssueEvent.field == IssueEventField.sprint,
                IssueEvent.new_value == str(sprint_id),
            )
        ).all()
    }


# --- cumulative flow ----------------------------------------------------


def cumulative_flow(
    session: Session, current_user: User, team_id: int, days: int = 30
) -> CumulativeFlow:
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)

    issue_ids = {
        issue.id
        for issue in session.exec(select(Issue).where(Issue.team_id == team_id)).all()
    }
    status_at, _, _ = _timelines(session, issue_ids)

    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days - 1)

    points: list[FlowPoint] = []
    for day in _days_between(start, today):
        moment = _end_of(day)
        counts = {category: 0 for category in StatusCategory}
        for issue_id in issue_ids:
            value = status_at.value_at(issue_id, moment)
            if value is None:
                # No status event at or before this day means the issue did
                # not exist yet. Counting it in `backlog` would draw work that
                # had not been created.
                continue
            counts[StatusCategory(value)] += 1
        points.append(FlowPoint(day=day, counts=counts))

    return CumulativeFlow(days=points)


# --- created vs resolved ------------------------------------------------


def created_vs_resolved(
    session: Session, current_user: User, team_id: int, days: int = 30
) -> CreatedVsResolved:
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)

    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days - 1)

    created_on: dict[date, int] = defaultdict(int)
    open_before_window = 0
    for issue in session.exec(select(Issue).where(Issue.team_id == team_id)).all():
        day = _as_utc(issue.created_at).date()
        if day >= start:
            created_on[day] += 1
        else:
            open_before_window += 1

    resolved_on: dict[date, int] = defaultdict(int)
    resolved_values = {category.value for category in RESOLVED}
    for event in session.exec(
        select(IssueEvent).where(
            IssueEvent.team_id == team_id,
            IssueEvent.field == IssueEventField.status,
        )
    ).all():
        day = _as_utc(event.created_at).date()
        was_open = event.old_value not in resolved_values
        if event.new_value in resolved_values and was_open:
            if day >= start:
                resolved_on[day] += 1
            else:
                open_before_window -= 1

    points: list[CreatedResolvedPoint] = []
    running = open_before_window
    for day in _days_between(start, today):
        created, resolved = created_on.get(day, 0), resolved_on.get(day, 0)
        running += created - resolved
        points.append(
            CreatedResolvedPoint(
                day=day,
                created=created,
                resolved=resolved,
                # Carries the backlog from before the window, so the line
                # starts where the backlog actually was rather than at zero.
                open_at_end_of_day=max(running, 0),
            )
        )

    return CreatedVsResolved(
        days=points,
        total_created=sum(created_on.values()),
        total_resolved=sum(resolved_on.values()),
    )


# --- time spent (#102) ---------------------------------------------------


def sprint_time_spent(
    session: Session, current_user: User, sprint_id: int
) -> TimeSpent:
    """Time logged during the sprint on the sprint's work, by person.

    "During" is the sprint's dates and "the sprint's work" is any issue that was
    ever in it -- so time spent before an issue was carried over to the next
    sprint stays with this one, and time spent on it afterwards goes with it.
    Taking the issues currently in the sprint instead would move a finished
    sprint's hours every time somebody tidied the backlog.
    """
    from lib_softtrack.worklogs import rollup

    sprint = get_sprint_or_404(session, sprint_id)
    require_team_member(sprint.team_id, current_user, session)
    issue_ids = _ever_in_sprint(session, sprint_id)
    if not issue_ids:
        return TimeSpent(total_minutes=0, by_person=[])
    rows = session.exec(
        select(Worklog, User)
        .join(User, User.id == Worklog.user_id)
        .where(
            Worklog.issue_id.in_(issue_ids),
            Worklog.worked_on >= sprint.starts_at.date(),
            Worklog.worked_on <= sprint.ends_at.date(),
        )
    ).all()
    return rollup(rows)


def team_time_spent(
    session: Session, current_user: User, team_id: int, days: int = 30
) -> TimeSpent:
    """Time logged on the team's issues over the last `days` days, by person."""
    from lib_softtrack.worklogs import rollup

    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    since = date.today() - timedelta(days=days - 1)
    rows = session.exec(
        select(Worklog, User)
        .join(User, User.id == Worklog.user_id)
        .join(Issue, Issue.id == Worklog.issue_id)
        .where(Issue.team_id == team_id, Worklog.worked_on >= since)
    ).all()
    return rollup(rows)

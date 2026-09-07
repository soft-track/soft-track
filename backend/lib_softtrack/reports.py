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

from sqlmodel import Session, select

from lib_softtrack.cycles import get_cycle_or_404
from lib_softtrack.models.reports import (
    Burndown,
    BurndownPoint,
    CreatedResolvedPoint,
    CreatedVsResolved,
    CumulativeFlow,
    FlowPoint,
    ScopeChange,
    Velocity,
    VelocityCycle,
)
from lib_softtrack.tables import (
    Cycle,
    CycleState,
    Issue,
    IssueEvent,
    IssueEventField,
    IssueStatus,
    User,
)
from lib_softtrack.teams import get_team_or_404, require_team_member

#: Statuses that take an issue off the burndown.
RESOLVED = (IssueStatus.done, IssueStatus.cancelled)
#: Only `done` counts as delivered. Cancelled work left the cycle without
#: being finished, so counting it as completed would flatter every chart.
DELIVERED = IssueStatus.done


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
        of(IssueEventField.cycle),
        of(IssueEventField.estimate),
    )


# --- burndown -----------------------------------------------------------


def burndown(session: Session, current_user: User, cycle_id: int) -> Burndown:
    cycle = get_cycle_or_404(session, cycle_id)
    require_team_member(cycle.team_id, current_user, session)

    # Every issue that was ever in this cycle, not just the ones in it now --
    # work that was pulled out mid-cycle still shaped the line while it was in.
    ever_in = {
        event.issue_id
        for event in session.exec(
            select(IssueEvent).where(
                IssueEvent.field == IssueEventField.cycle,
                IssueEvent.new_value == str(cycle_id),
            )
        ).all()
    }
    ever_in |= {
        issue.id
        for issue in session.exec(select(Issue).where(Issue.cycle_id == cycle_id)).all()
    }

    status_at, cycle_at, estimate_at = _timelines(session, ever_in)

    start = _as_utc(cycle.starts_at).date()
    end = _as_utc(cycle.ends_at).date()
    today = datetime.now(timezone.utc).date()
    # Never chart the future: a line running flat to the end of the sprint
    # reads as "nothing is happening" rather than "this has not happened yet".
    last = min(end, today) if cycle.state != CycleState.completed else end

    points: list[BurndownPoint] = []
    scope_changes: list[ScopeChange] = []
    opening_total: Optional[int] = None
    previous: Optional[tuple[set[int], int]] = None
    span = max((end - start).days, 1)

    for offset, day in enumerate(_days_between(start, max(last, start))):
        moment = _end_of(day)
        in_cycle: set[int] = set()
        total = remaining = completed = issues_remaining = 0

        for issue_id in ever_in:
            if cycle_at.value_at(issue_id, moment) != str(cycle_id):
                continue
            in_cycle.add(issue_id)

            raw_estimate = estimate_at.value_at(issue_id, moment)
            estimate = int(raw_estimate) if raw_estimate else 0
            status = status_at.value_at(issue_id, moment)

            total += estimate
            if status == DELIVERED.value:
                completed += estimate
            elif status not in {s.value for s in RESOLVED}:
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
            added, removed = in_cycle - before_ids, before_ids - in_cycle
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
        previous = (in_cycle, total)

    return Burndown(
        cycle_id=cycle.id,
        cycle_name=cycle.name or f"Cycle {cycle.number}",
        starts_at=start,
        ends_at=end,
        points=points,
        scope_changes=scope_changes,
    )


# --- velocity -----------------------------------------------------------


def velocity(
    session: Session, current_user: User, team_id: int, limit: int = 6
) -> Velocity:
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)

    completed_cycles = session.exec(
        select(Cycle)
        .where(Cycle.team_id == team_id, Cycle.state == CycleState.completed)
        .order_by(Cycle.number.desc())
        .limit(limit)
    ).all()
    completed_cycles = list(reversed(completed_cycles))

    rows: list[VelocityCycle] = []
    for cycle in completed_cycles:
        issues = session.exec(select(Issue).where(Issue.cycle_id == cycle.id)).all()
        delivered = [issue for issue in issues if issue.status is DELIVERED]

        # Committed is the scope at the moment the cycle started, not what it
        # ended with. A team that finished everything it added late did not
        # commit to it.
        _, cycle_at, estimate_at = _timelines(
            session, {issue.id for issue in issues} | _ever_in_cycle(session, cycle.id)
        )
        opened = _end_of(_as_utc(cycle.starts_at).date())
        committed = 0
        for issue_id in cycle_at.issue_ids:
            if cycle_at.value_at(issue_id, opened) != str(cycle.id):
                continue
            raw = estimate_at.value_at(issue_id, opened)
            committed += int(raw) if raw else 0

        rows.append(
            VelocityCycle(
                cycle_id=cycle.id,
                cycle_name=cycle.name or f"Cycle {cycle.number}",
                completed_at=(
                    _as_utc(cycle.completed_at).date() if cycle.completed_at else None
                ),
                points_committed=committed,
                points_completed=sum(issue.estimate or 0 for issue in delivered),
                issues_completed=len(delivered),
            )
        )

    return Velocity(
        cycles=rows,
        # None rather than 0 for an empty history: zero reads as "this team
        # delivers nothing", which is a different and much worse claim.
        average_points=(
            round(sum(row.points_completed for row in rows) / len(rows), 1)
            if rows
            else None
        ),
    )


def _ever_in_cycle(session: Session, cycle_id: int) -> set[int]:
    return {
        event.issue_id
        for event in session.exec(
            select(IssueEvent).where(
                IssueEvent.field == IssueEventField.cycle,
                IssueEvent.new_value == str(cycle_id),
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
        counts = {status: 0 for status in IssueStatus}
        for issue_id in issue_ids:
            value = status_at.value_at(issue_id, moment)
            if value is None:
                # No status event at or before this day means the issue did
                # not exist yet. Counting it in `backlog` would draw work that
                # had not been created.
                continue
            counts[IssueStatus(value)] += 1
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
    resolved_values = {status.value for status in RESOLVED}
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

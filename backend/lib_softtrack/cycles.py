"""Cycles: time-boxed iterations for a team.

Two decisions shape everything here.

**State is set, not derived.** A cycle could infer "active" from the current
date falling between its bounds, but then a team that forgets to start on
Monday has Monday counted against its burndown, and a cycle that runs a day
long silently completes itself and carries work away while nobody is looking.
The dates are the plan; the state is what actually happened.

**Completing a cycle never deletes work.** Unfinished issues move to the next
upcoming cycle, or back to the backlog if there is none. A cycle boundary is
an accounting event, not a reason to lose anything.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import case, func
from sqlmodel import Session, select

from lib_softtrack.models.cycles import (
    CycleCompletion,
    CycleCreate,
    CycleProgress,
    CycleRead,
    CycleUpdate,
)
from lib_softtrack.tables import Cycle, CycleState, Issue, IssueStatus, User
from lib_softtrack.teams import get_team_or_404, require_team_member

#: Statuses that count as finished for cycle progress and for deciding what
#: carries over. Cancelled counts as finished: it is not outstanding work, and
#: dragging it into the next cycle forever would be wrong.
DONE_STATUSES = (IssueStatus.done, IssueStatus.cancelled)

#: Only `done` counts as *completed* in the progress numbers -- cancelled work
#: was not delivered, so counting it would flatter the burndown.
_COMPLETED = IssueStatus.done


def get_cycle_or_404(session: Session, cycle_id: int) -> Cycle:
    cycle = session.get(Cycle, cycle_id)
    if cycle is None:
        raise HTTPException(status_code=404, detail="Cycle not found")
    return cycle


def cycle_progress(session: Session, cycle_ids: list[int]) -> dict[int, CycleProgress]:
    """Progress for several cycles in one query."""
    if not cycle_ids:
        return {}

    completed = case((Issue.status == _COMPLETED, 1), else_=0)
    rows = session.exec(
        select(
            Issue.cycle_id,
            func.count(),
            func.coalesce(func.sum(completed), 0),
            func.coalesce(func.sum(Issue.estimate), 0),
            func.coalesce(
                func.sum(case((Issue.status == _COMPLETED, Issue.estimate), else_=0)), 0
            ),
            func.count(Issue.estimate),
        )
        .where(Issue.cycle_id.in_(cycle_ids))
        .group_by(Issue.cycle_id)
    ).all()

    progress = {
        cycle_id: CycleProgress(
            issues_total=int(total),
            issues_completed=int(done),
            points_total=int(points),
            points_completed=int(points_done),
            issues_unestimated=int(total) - int(sized),
        )
        for cycle_id, total, done, points, points_done, sized in rows
    }

    for cycle_id in cycle_ids:
        progress.setdefault(
            cycle_id,
            CycleProgress(
                issues_total=0,
                issues_completed=0,
                points_total=0,
                points_completed=0,
                issues_unestimated=0,
            ),
        )
    return progress


def cycle_to_read(cycle: Cycle, progress: CycleProgress) -> CycleRead:
    return CycleRead(
        id=cycle.id,
        team_id=cycle.team_id,
        number=cycle.number,
        name=cycle.name,
        display_name=cycle.name or f"Cycle {cycle.number}",
        starts_at=cycle.starts_at,
        ends_at=cycle.ends_at,
        state=cycle.state,
        completed_at=cycle.completed_at,
        progress=progress,
    )


def _read(session: Session, cycle: Cycle) -> CycleRead:
    return cycle_to_read(cycle, cycle_progress(session, [cycle.id])[cycle.id])


def create_cycle(
    session: Session, current_user: User, team_id: int, payload: CycleCreate
) -> CycleRead:
    team = get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)

    cycle = Cycle(
        team_id=team_id,
        number=team.next_cycle_number,
        name=payload.name,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
    )
    team.next_cycle_number += 1
    session.add(team)
    session.add(cycle)
    session.commit()
    session.refresh(cycle)
    return _read(session, cycle)


def list_cycles(session: Session, current_user: User, team_id: int) -> list[CycleRead]:
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)

    cycles = session.exec(
        select(Cycle).where(Cycle.team_id == team_id).order_by(Cycle.number)
    ).all()
    progress = cycle_progress(session, [cycle.id for cycle in cycles])
    return [cycle_to_read(cycle, progress[cycle.id]) for cycle in cycles]


def get_cycle(session: Session, current_user: User, cycle_id: int) -> CycleRead:
    cycle = get_cycle_or_404(session, cycle_id)
    require_team_member(cycle.team_id, current_user, session)
    return _read(session, cycle)


def update_cycle(
    session: Session, current_user: User, cycle_id: int, payload: CycleUpdate
) -> CycleRead:
    cycle = get_cycle_or_404(session, cycle_id)
    require_team_member(cycle.team_id, current_user, session)

    if cycle.state is CycleState.completed:
        raise HTTPException(
            status_code=409,
            detail="A completed cycle cannot be changed; its numbers are history.",
        )

    data = payload.model_dump(exclude_unset=True)
    starts_at = data.get("starts_at", cycle.starts_at)
    ends_at = data.get("ends_at", cycle.ends_at)
    if ends_at <= starts_at:
        raise HTTPException(status_code=422, detail="ends_at must be after starts_at")

    for field, value in data.items():
        setattr(cycle, field, value)
    session.add(cycle)
    session.commit()
    session.refresh(cycle)
    return _read(session, cycle)


def start_cycle(session: Session, current_user: User, cycle_id: int) -> CycleRead:
    cycle = get_cycle_or_404(session, cycle_id)
    require_team_member(cycle.team_id, current_user, session)

    if cycle.state is CycleState.completed:
        raise HTTPException(status_code=409, detail="That cycle is already completed.")
    if cycle.state is CycleState.active:
        return _read(session, cycle)

    active = session.exec(
        select(Cycle).where(
            Cycle.team_id == cycle.team_id, Cycle.state == CycleState.active
        )
    ).first()
    if active is not None:
        # Two active cycles would make "the current cycle" ambiguous for every
        # burndown and every board filter that follows.
        raise HTTPException(
            status_code=409,
            detail=(
                f"{active.name or f'Cycle {active.number}'} is still active. "
                "Complete it before starting another."
            ),
        )

    cycle.state = CycleState.active
    session.add(cycle)
    session.commit()
    session.refresh(cycle)
    return _read(session, cycle)


def complete_cycle(
    session: Session, current_user: User, cycle_id: int
) -> CycleCompletion:
    cycle = get_cycle_or_404(session, cycle_id)
    require_team_member(cycle.team_id, current_user, session)

    if cycle.state is CycleState.completed:
        raise HTTPException(status_code=409, detail="That cycle is already completed.")

    unfinished = session.exec(
        select(Issue).where(
            Issue.cycle_id == cycle.id, Issue.status.not_in(DONE_STATUSES)
        )
    ).all()

    # The next cycle by number that has not been completed. Carrying into an
    # already-completed cycle would rewrite history that has been reported on.
    successor = session.exec(
        select(Cycle)
        .where(
            Cycle.team_id == cycle.team_id,
            Cycle.number > cycle.number,
            Cycle.state != CycleState.completed,
        )
        .order_by(Cycle.number)
    ).first()

    for issue in unfinished:
        # No successor means the backlog, not limbo -- an issue must never end
        # up pointing at a cycle that is over.
        issue.cycle_id = successor.id if successor else None
        session.add(issue)

    cycle.state = CycleState.completed
    cycle.completed_at = datetime.now(timezone.utc)
    session.add(cycle)
    session.commit()
    session.refresh(cycle)

    return CycleCompletion(
        cycle=_read(session, cycle),
        carried_over=len(unfinished),
        carried_into_cycle_id=successor.id if successor else None,
    )


def delete_cycle(session: Session, current_user: User, cycle_id: int) -> None:
    cycle = get_cycle_or_404(session, cycle_id)
    require_team_member(cycle.team_id, current_user, session)

    if cycle.state is CycleState.completed:
        raise HTTPException(
            status_code=409,
            detail="A completed cycle cannot be deleted; its numbers are history.",
        )

    # Its issues go back to the backlog rather than being deleted with it, and
    # they hold a foreign key here either way.
    for issue in session.exec(select(Issue).where(Issue.cycle_id == cycle_id)).all():
        issue.cycle_id = None
        session.add(issue)
    session.flush()

    session.delete(cycle)
    session.commit()


def active_cycle(session: Session, team_id: int) -> Optional[Cycle]:
    return session.exec(
        select(Cycle).where(Cycle.team_id == team_id, Cycle.state == CycleState.active)
    ).first()

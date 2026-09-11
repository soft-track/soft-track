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

from lib_softtrack import automations as automations_service
from lib_softtrack import rules as rules_service
from lib_softtrack import views as views_service
from lib_softtrack.history import record_changes, snapshot
from lib_softtrack.models.cycles import (
    CycleCompletion,
    CycleCreate,
    CycleProgress,
    CycleRead,
    CycleUpdate,
)
from lib_softtrack.statuses import in_category
from lib_softtrack.tables import Cycle, CycleState, Issue, StatusCategory, User
from lib_softtrack.teams import get_team_or_404, require_team_member

#: Statuses that count as finished for cycle progress and for deciding what
#: carries over. Cancelled counts as finished: it is not outstanding work, and
#: dragging it into the next cycle forever would be wrong.
DONE_STATUSES = (StatusCategory.done, StatusCategory.cancelled)

#: Only `done` counts as *completed* in the progress numbers -- cancelled work
#: was not delivered, so counting it would flatter the burndown.
_COMPLETED = StatusCategory.done


def get_cycle_or_404(session: Session, cycle_id: int) -> Cycle:
    cycle = session.get(Cycle, cycle_id)
    if cycle is None:
        raise HTTPException(status_code=404, detail="Cycle not found")
    return cycle


def cycle_progress(session: Session, cycle_ids: list[int]) -> dict[int, CycleProgress]:
    """Progress for several cycles in one query."""
    if not cycle_ids:
        return {}

    completed = case((in_category(_COMPLETED), 1), else_=0)
    rows = session.exec(
        select(
            Issue.cycle_id,
            func.count(),
            func.coalesce(func.sum(completed), 0),
            func.coalesce(func.sum(Issue.estimate), 0),
            func.coalesce(
                func.sum(case((in_category(_COMPLETED), Issue.estimate), else_=0)), 0
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

    # Read before anything moves: a `cycle_completed` rule is about the work
    # that was in this cycle, which after the carry-over below is no longer a
    # question the issue rows can answer.
    members = list(session.exec(select(Issue).where(Issue.cycle_id == cycle.id)).all())

    unfinished = session.exec(
        select(Issue).where(Issue.cycle_id == cycle.id, ~in_category(*DONE_STATUSES))
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
        before = snapshot(issue)
        issue.cycle_id = successor.id if successor else None
        session.add(issue)
        # Carry-over is a scope change like any other, and a report that
        # cannot see it would show work vanishing from one cycle and
        # appearing in the next with no explanation.
        record_changes(session, issue, before, current_user)

    cycle.state = CycleState.completed
    cycle.completed_at = datetime.now(timezone.utc)
    session.add(cycle)

    # After the carry-over, so a rule can act on the issues that came out of
    # the cycle unfinished as well as the ones that stayed.
    rules_service.on_cycle_completed(session, cycle, members, current_user)

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
        before = snapshot(issue)
        issue.cycle_id = None
        session.add(issue)
        record_changes(session, issue, before, current_user)

    # Saved views hold one too. A view left filtering on a cycle that no
    # longer exists matches nothing, which reads as broken rather than empty.
    views_service.clear_cycle(session, cycle_id)
    # And any rule that moved work into it, which is switched off rather than
    # left enabled doing less than it says -- see automations.clear_cycle.
    automations_service.clear_cycle(session, cycle_id)
    session.flush()

    session.delete(cycle)
    session.commit()


def active_cycle(session: Session, team_id: int) -> Optional[Cycle]:
    return session.exec(
        select(Cycle).where(Cycle.team_id == team_id, Cycle.state == CycleState.active)
    ).first()

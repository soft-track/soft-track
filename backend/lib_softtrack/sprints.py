"""Sprints: time-boxed iterations for a team.

Two decisions shape everything here.

**State is set, not derived.** A sprint could infer "active" from the current
date falling between its bounds, but then a team that forgets to start on
Monday has Monday counted against its burndown, and a sprint that runs a day
long silently completes itself and carries work away while nobody is looking.
The dates are the plan; the state is what actually happened.

**Completing a sprint never deletes work.** Unfinished issues move to the next
upcoming sprint, or back to the backlog if there is none. A sprint boundary is
an accounting event, not a reason to lose anything.
"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import case, func
from sqlmodel import Session, select

from lib_softtrack import outbound
from lib_softtrack import automations as automations_service
from lib_softtrack import rules as rules_service
from lib_softtrack import views as views_service
from lib_softtrack.history import record_changes, snapshot
from lib_softtrack.models.sprints import (
    SprintCompletion,
    SprintCreate,
    SprintProgress,
    SprintRead,
    SprintUpdate,
)
from lib_softtrack.statuses import in_category
from lib_softtrack.tables import (
    Sprint,
    SprintState,
    Issue,
    StatusCategory,
    User,
    WebhookEvent,
)
from lib_softtrack.teams import get_team_or_404, require_team_member
from lib_utils.errors import ErrorCode, api_error

#: Statuses that count as finished for sprint progress and for deciding what
#: carries over. Cancelled counts as finished: it is not outstanding work, and
#: dragging it into the next sprint forever would be wrong.
DONE_STATUSES = (StatusCategory.done, StatusCategory.cancelled)

#: Only `done` counts as *completed* in the progress numbers -- cancelled work
#: was not delivered, so counting it would flatter the burndown.
_COMPLETED = StatusCategory.done


def get_sprint_or_404(session: Session, sprint_id: int) -> Sprint:
    sprint = session.get(Sprint, sprint_id)
    if sprint is None:
        raise api_error(
            status_code=404, code=ErrorCode.sprint_not_found, detail="Sprint not found"
        )
    return sprint


def sprint_progress(
    session: Session, sprint_ids: list[int]
) -> dict[int, SprintProgress]:
    """Progress for several sprints in one query."""
    if not sprint_ids:
        return {}

    completed = case((in_category(_COMPLETED), 1), else_=0)
    rows = session.exec(
        select(
            Issue.sprint_id,
            func.count(),
            func.coalesce(func.sum(completed), 0),
            func.coalesce(func.sum(Issue.estimate), 0),
            func.coalesce(
                func.sum(case((in_category(_COMPLETED), Issue.estimate), else_=0)), 0
            ),
            func.count(Issue.estimate),
        )
        .where(Issue.sprint_id.in_(sprint_ids))
        .group_by(Issue.sprint_id)
    ).all()

    progress = {
        sprint_id: SprintProgress(
            issues_total=int(total),
            issues_completed=int(done),
            points_total=int(points),
            points_completed=int(points_done),
            issues_unestimated=int(total) - int(sized),
        )
        for sprint_id, total, done, points, points_done, sized in rows
    }

    for sprint_id in sprint_ids:
        progress.setdefault(
            sprint_id,
            SprintProgress(
                issues_total=0,
                issues_completed=0,
                points_total=0,
                points_completed=0,
                issues_unestimated=0,
            ),
        )
    return progress


def display_name(sprint: Sprint) -> str:
    """What to call a sprint anywhere a person will read it.

    Naming a sprint is optional -- most teams never bother -- so an unnamed one
    goes by its number instead. Everything that shows a sprint to somebody
    (the API payload, reports, rule descriptions, the CSV export) has to make
    the same substitution, so it is made here once.
    """
    return sprint.name or f"Sprint {sprint.number}"


def sprint_to_read(sprint: Sprint, progress: SprintProgress) -> SprintRead:
    return SprintRead(
        id=sprint.id,
        team_id=sprint.team_id,
        number=sprint.number,
        name=sprint.name,
        display_name=display_name(sprint),
        starts_at=sprint.starts_at,
        ends_at=sprint.ends_at,
        state=sprint.state,
        completed_at=sprint.completed_at,
        progress=progress,
    )


def _read(session: Session, sprint: Sprint) -> SprintRead:
    return sprint_to_read(sprint, sprint_progress(session, [sprint.id])[sprint.id])


def create_sprint(
    session: Session, current_user: User, team_id: int, payload: SprintCreate
) -> SprintRead:
    team = get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)

    sprint = Sprint(
        team_id=team_id,
        number=team.next_sprint_number,
        name=payload.name,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
    )
    team.next_sprint_number += 1
    session.add(team)
    session.add(sprint)
    session.commit()
    session.refresh(sprint)
    return _read(session, sprint)


def list_sprints(
    session: Session, current_user: User, team_id: int
) -> list[SprintRead]:
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)

    sprints = session.exec(
        select(Sprint).where(Sprint.team_id == team_id).order_by(Sprint.number)
    ).all()
    progress = sprint_progress(session, [sprint.id for sprint in sprints])
    return [sprint_to_read(sprint, progress[sprint.id]) for sprint in sprints]


def get_sprint(session: Session, current_user: User, sprint_id: int) -> SprintRead:
    sprint = get_sprint_or_404(session, sprint_id)
    require_team_member(sprint.team_id, current_user, session)
    return _read(session, sprint)


def update_sprint(
    session: Session, current_user: User, sprint_id: int, payload: SprintUpdate
) -> SprintRead:
    sprint = get_sprint_or_404(session, sprint_id)
    require_team_member(sprint.team_id, current_user, session)

    if sprint.state is SprintState.completed:
        raise api_error(
            status_code=409,
            code=ErrorCode.sprint_completed,
            detail="A completed sprint cannot be changed; its numbers are history.",
        )

    data = payload.model_dump(exclude_unset=True)
    starts_at = data.get("starts_at", sprint.starts_at)
    ends_at = data.get("ends_at", sprint.ends_at)
    if ends_at <= starts_at:
        raise api_error(
            status_code=422,
            code=ErrorCode.sprint_dates_invalid,
            detail="ends_at must be after starts_at",
        )

    for field, value in data.items():
        setattr(sprint, field, value)
    session.add(sprint)
    session.commit()
    session.refresh(sprint)
    return _read(session, sprint)


def start_sprint(session: Session, current_user: User, sprint_id: int) -> SprintRead:
    sprint = get_sprint_or_404(session, sprint_id)
    require_team_member(sprint.team_id, current_user, session)

    if sprint.state is SprintState.completed:
        raise api_error(
            status_code=409,
            code=ErrorCode.sprint_completed,
            detail="That sprint is already completed.",
        )
    if sprint.state is SprintState.active:
        return _read(session, sprint)

    active = session.exec(
        select(Sprint).where(
            Sprint.team_id == sprint.team_id, Sprint.state == SprintState.active
        )
    ).first()
    if active is not None:
        # Two active sprints would make "the current sprint" ambiguous for every
        # burndown and every board filter that follows.
        raise api_error(
            status_code=409,
            code=ErrorCode.sprint_already_active,
            detail=(
                f"{active.name or f'Sprint {active.number}'} is still active. "
                "Complete it before starting another."
            ),
        )

    sprint.state = SprintState.active
    session.add(sprint)
    outbound.emit(
        session,
        sprint.team_id,
        WebhookEvent.sprint_started,
        lambda: {"sprint": _read(session, sprint)},
        current_user,
    )
    session.commit()
    session.refresh(sprint)
    return _read(session, sprint)


def complete_sprint(
    session: Session, current_user: User, sprint_id: int
) -> SprintCompletion:
    sprint = get_sprint_or_404(session, sprint_id)
    require_team_member(sprint.team_id, current_user, session)

    if sprint.state is SprintState.completed:
        raise api_error(
            status_code=409,
            code=ErrorCode.sprint_completed,
            detail="That sprint is already completed.",
        )

    # Read before anything moves: a `sprint_completed` rule is about the work
    # that was in this sprint, which after the carry-over below is no longer a
    # question the issue rows can answer.
    members = list(
        session.exec(select(Issue).where(Issue.sprint_id == sprint.id)).all()
    )

    unfinished = session.exec(
        select(Issue).where(Issue.sprint_id == sprint.id, ~in_category(*DONE_STATUSES))
    ).all()

    # The next sprint by number that has not been completed. Carrying into an
    # already-completed sprint would rewrite history that has been reported on.
    successor = session.exec(
        select(Sprint)
        .where(
            Sprint.team_id == sprint.team_id,
            Sprint.number > sprint.number,
            Sprint.state != SprintState.completed,
        )
        .order_by(Sprint.number)
    ).first()

    for issue in unfinished:
        # No successor means the backlog, not limbo -- an issue must never end
        # up pointing at a sprint that is over.
        before = snapshot(issue)
        issue.sprint_id = successor.id if successor else None
        session.add(issue)
        # Carry-over is a scope change like any other, and a report that
        # cannot see it would show work vanishing from one sprint and
        # appearing in the next with no explanation.
        record_changes(session, issue, before, current_user)

    sprint.state = SprintState.completed
    sprint.completed_at = datetime.now(timezone.utc)
    session.add(sprint)

    # After the carry-over, so a rule can act on the issues that came out of
    # the sprint unfinished as well as the ones that stayed.
    rules_service.on_sprint_completed(session, sprint, members, current_user)
    outbound.emit(
        session,
        sprint.team_id,
        WebhookEvent.sprint_completed,
        lambda: {
            "sprint": _read(session, sprint),
            "carried_over": len(unfinished),
            "carried_into_sprint_id": successor.id if successor else None,
        },
        current_user,
    )

    session.commit()
    session.refresh(sprint)

    return SprintCompletion(
        sprint=_read(session, sprint),
        carried_over=len(unfinished),
        carried_into_sprint_id=successor.id if successor else None,
    )


def delete_sprint(session: Session, current_user: User, sprint_id: int) -> None:
    sprint = get_sprint_or_404(session, sprint_id)
    require_team_member(sprint.team_id, current_user, session)

    if sprint.state is SprintState.completed:
        raise api_error(
            status_code=409,
            code=ErrorCode.sprint_completed,
            detail="A completed sprint cannot be deleted; its numbers are history.",
        )

    # Its issues go back to the backlog rather than being deleted with it, and
    # they hold a foreign key here either way.
    for issue in session.exec(select(Issue).where(Issue.sprint_id == sprint_id)).all():
        before = snapshot(issue)
        issue.sprint_id = None
        session.add(issue)
        record_changes(session, issue, before, current_user)

    # Saved views hold one too. A view left filtering on a sprint that no
    # longer exists matches nothing, which reads as broken rather than empty.
    views_service.clear_sprint(session, sprint_id)
    # And any rule that moved work into it, which is switched off rather than
    # left enabled doing less than it says -- see automations.clear_sprint.
    automations_service.clear_sprint(session, sprint_id)
    session.flush()

    session.delete(sprint)
    session.commit()


def active_sprint(session: Session, team_id: int) -> Optional[Sprint]:
    return session.exec(
        select(Sprint).where(
            Sprint.team_id == team_id, Sprint.state == SprintState.active
        )
    ).first()

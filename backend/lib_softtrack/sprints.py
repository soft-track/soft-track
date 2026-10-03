"""Sprints: time-boxed iterations for a team.

Two decisions shape everything here.

**State is set, not derived.** A sprint could infer "active" from the current
date falling between its bounds, but then a team that forgets to start on
Monday has Monday counted against its burndown, and a sprint that runs a day
long silently completes itself and carries work away while nobody is looking.
The dates are the plan; the state is what actually happened.

**Completing a sprint never deletes work.** Unfinished tickets move to the next
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
    RetroActionCreate,
    RetroActionRead,
    Retrospective,
    RetrospectiveUpdate,
    SprintCompleteRequest,
    SprintCompletion,
    SprintCreate,
    SprintProgress,
    SprintRead,
    SprintUpdate,
)
from lib_softtrack.statuses import in_category
from lib_softtrack.tables import (
    Sprint,
    SprintAction,
    SprintState,
    Team,
    Ticket,
    StatusCategory,
    User,
    WebhookEvent,
    utcnow,
)
from lib_softtrack.teams import (
    get_team_or_404,
    require_team_admin,
    require_team_member,
    require_team_writer,
)
from lib_softtrack.trash import INCLUDE_TRASHED
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
            Ticket.sprint_id,
            func.count(),
            func.coalesce(func.sum(completed), 0),
            func.coalesce(func.sum(Ticket.estimate), 0),
            func.coalesce(
                func.sum(case((in_category(_COMPLETED), Ticket.estimate), else_=0)), 0
            ),
            func.count(Ticket.estimate),
        )
        .where(Ticket.sprint_id.in_(sprint_ids))
        .group_by(Ticket.sprint_id)
    ).all()

    progress = {
        sprint_id: SprintProgress(
            tickets_total=int(total),
            tickets_completed=int(done),
            points_total=int(points),
            points_completed=int(points_done),
            tickets_unestimated=int(total) - int(sized),
        )
        for sprint_id, total, done, points, points_done, sized in rows
    }

    for sprint_id in sprint_ids:
        progress.setdefault(
            sprint_id,
            SprintProgress(
                tickets_total=0,
                tickets_completed=0,
                points_total=0,
                points_completed=0,
                tickets_unestimated=0,
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


def sprint_to_read(
    sprint: Sprint,
    progress: SprintProgress,
    actions: Optional[list[RetroActionRead]] = None,
) -> SprintRead:
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
        goal=sprint.goal,
        goal_outcome=sprint.goal_outcome,
        retrospective=(
            Retrospective(
                went_well=sprint.retro_went_well,
                did_not=sprint.retro_did_not,
                to_change=sprint.retro_to_change,
                closed_at=sprint.retro_closed_at,
                actions=actions or [],
            )
            if sprint.state is SprintState.completed
            else None
        ),
    )


def _actions(
    session: Session, sprint_ids: list[int]
) -> dict[int, list[RetroActionRead]]:
    """Each sprint's retrospective actions with the tickets they became, for
    a list of sprints in one query (#271)."""
    if not sprint_ids:
        return {}
    found: dict[int, list[RetroActionRead]] = {}
    for action, ticket, team in session.exec(
        select(SprintAction, Ticket, Team)
        .join(Ticket, Ticket.id == SprintAction.ticket_id)
        .join(Team, Team.id == Ticket.team_id)
        .where(SprintAction.sprint_id.in_(sprint_ids))
        .order_by(SprintAction.created_at, SprintAction.id)
    ).all():
        found.setdefault(action.sprint_id, []).append(
            RetroActionRead(
                id=action.id,
                text=action.text,
                ticket_id=ticket.id,
                identifier=f"{team.key}-{ticket.number}",
                created_at=action.created_at,
            )
        )
    return found


def _read(session: Session, sprint: Sprint) -> SprintRead:
    return sprint_to_read(
        sprint,
        sprint_progress(session, [sprint.id])[sprint.id],
        _actions(session, [sprint.id]).get(sprint.id),
    )


def _text(value: Optional[str]) -> Optional[str]:
    """Blank is nothing: a goal or a section of whitespace reads as unset."""
    return value.strip() or None if value is not None else None


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
        goal=_text(payload.goal),
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
    actions = _actions(
        session,
        [sprint.id for sprint in sprints if sprint.state is SprintState.completed],
    )
    return [
        sprint_to_read(sprint, progress[sprint.id], actions.get(sprint.id))
        for sprint in sprints
    ]


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

    if "goal" in data:
        data["goal"] = _text(data["goal"])
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
    session: Session,
    current_user: User,
    sprint_id: int,
    payload: Optional[SprintCompleteRequest] = None,
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
    # question the ticket rows can answer.
    members = list(
        session.exec(select(Ticket).where(Ticket.sprint_id == sprint.id)).all()
    )

    unfinished = session.exec(
        select(Ticket).where(
            Ticket.sprint_id == sprint.id, ~in_category(*DONE_STATUSES)
        )
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

    for ticket in unfinished:
        # No successor means the backlog, not limbo -- a ticket must never end
        # up pointing at a sprint that is over.
        before = snapshot(ticket)
        ticket.sprint_id = successor.id if successor else None
        session.add(ticket)
        # Carry-over is a scope change like any other, and a report that
        # cannot see it would show work vanishing from one sprint and
        # appearing in the next with no explanation.
        record_changes(session, ticket, before, current_user)

    sprint.state = SprintState.completed
    sprint.completed_at = datetime.now(timezone.utc)
    # Whether the goal was met, and the retrospective so far (#271): asked
    # when it is completed, before the webhook says so, and all optional.
    if payload is not None:
        sprint.goal_outcome = payload.outcome
        sprint.retro_went_well = _text(payload.went_well)
        sprint.retro_did_not = _text(payload.did_not)
        sprint.retro_to_change = _text(payload.to_change)
    session.add(sprint)

    # After the carry-over, so a rule can act on the tickets that came out of
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


def _retrospective_of(
    session: Session, current_user: User, sprint_id: int, *, admin: bool = False
) -> Sprint:
    """A completed sprint whose retrospective the caller may write: anybody
    on the team but a guest while it is open (#271), its admins to close it."""
    sprint = get_sprint_or_404(session, sprint_id)
    if admin:
        require_team_admin(sprint.team_id, current_user, session)
    else:
        require_team_writer(sprint.team_id, current_user, session)
    if sprint.state is not SprintState.completed:
        raise api_error(
            status_code=409,
            code=ErrorCode.sprint_not_completed,
            detail="A retrospective is written once the sprint is completed.",
        )
    return sprint


def update_retrospective(
    session: Session, current_user: User, sprint_id: int, payload: RetrospectiveUpdate
) -> SprintRead:
    """Write to a completed sprint's retrospective while it is open (#271)."""
    sprint = _retrospective_of(session, current_user, sprint_id)
    if sprint.retro_closed_at is not None:
        raise api_error(
            status_code=409,
            code=ErrorCode.retrospective_closed,
            detail="This retrospective has been closed.",
        )
    data = payload.model_dump(exclude_unset=True)
    if "outcome" in data:
        sprint.goal_outcome = data["outcome"]
    for field, column in (
        ("went_well", "retro_went_well"),
        ("did_not", "retro_did_not"),
        ("to_change", "retro_to_change"),
    ):
        if field in data:
            setattr(sprint, column, _text(data[field]))
    session.add(sprint)
    session.commit()
    session.refresh(sprint)
    return _read(session, sprint)


def close_retrospective(
    session: Session, current_user: User, sprint_id: int
) -> SprintRead:
    """Stop the retrospective changing: a team admin's call (#271)."""
    sprint = _retrospective_of(session, current_user, sprint_id, admin=True)
    if sprint.retro_closed_at is None:
        sprint.retro_closed_at = utcnow()
        session.add(sprint)
        session.commit()
        session.refresh(sprint)
    return _read(session, sprint)


def create_action(
    session: Session, current_user: User, sprint_id: int, payload: RetroActionCreate
) -> RetroActionRead:
    """Make a ticket of a line from "what to change" (#271), linked back to
    the sprint it came from. The ticket goes on the team's backlog like any
    other new one."""
    # Imported here: tickets name sprints, so read this module first.
    from lib_softtrack import tickets as tickets_service
    from lib_softtrack.models.tickets import TicketCreate

    sprint = _retrospective_of(session, current_user, sprint_id)
    text = payload.text.strip()
    created = tickets_service.create_ticket(
        session,
        current_user,
        sprint.team_id,
        TicketCreate(
            title=text[:200],
            description=f"From the retrospective of {display_name(sprint)}.",
        ),
    )
    action = SprintAction(sprint_id=sprint.id, ticket_id=created.id, text=text)
    session.add(action)
    session.commit()
    session.refresh(action)
    return RetroActionRead(
        id=action.id,
        text=action.text,
        ticket_id=created.id,
        identifier=created.identifier,
        created_at=action.created_at,
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

    # Its tickets go back to the backlog rather than being deleted with it, and
    # they hold a foreign key here either way -- the ones in the trash too
    # (#323), or the sprint could not go.
    for ticket in session.exec(
        select(Ticket)
        .where(Ticket.sprint_id == sprint_id)
        .execution_options(**INCLUDE_TRASHED)
    ).all():
        before = snapshot(ticket)
        ticket.sprint_id = None
        session.add(ticket)
        record_changes(session, ticket, before, current_user)

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

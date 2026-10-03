"""Moving a ticket to another team (#98).

Tickets are numbered per team and most of what hangs off one is per team too,
so a move is not a field change. The rules, which `plan` computes and
`transfer_ticket` carries out:

- **Key.** The ticket takes the target team's next number. `ENG-42` becomes
  `OPS-17`; the old key cannot be kept, because keys are per team and
  `ENG-42` will never be reused on ENG either. A comment on the ticket saying
  "Moved from ENG-42" is what keeps the old key findable in search.
- **Status** maps by category: the target team's first status in the same
  category, or its first column if it has none in that category.
- **Labels** are kept where the target team has one of the same name, ignoring
  case, and dropped otherwise.
- **Sprint** and **project** are cleared; both belong to one team.
- **Assignee** is cleared if they are not on the target team.
- **Custom fields** (#117) are cleared. They are the old team's own, and a
  "Reviewer" on the target team is a different field that may mean somebody
  else -- matching them by name would be a guess made on nobody's behalf.
- **Parent.** A sub-ticket whose parent stays behind becomes top level --
  sub-tickets must share a team with their parent.
- **Sub-tickets** move with their parent, by the same rules. The alternative,
  refusing the move, turns one action into several and leaves the hierarchy
  broken while it is done by hand.

Everything else stays with the ticket because it is keyed by the ticket, not
the team: comments, attachments, history, links, watchers, linked branches
and pull requests. Watchers who are not on the target team stop being
notified, the way anybody who leaves a team does.
"""

from dataclasses import dataclass, field
from typing import Optional

from sqlmodel import Session, select

from lib_softtrack import wip
from lib_softtrack import custom_fields as custom_fields_service
from lib_softtrack.history import record_changes, snapshot
from lib_softtrack.tickets import get_ticket_or_404, ticket_to_read, set_labels
from lib_softtrack.models.transfers import (
    StatusChange,
    TransferPlan,
    TransferResult,
)
from lib_softtrack.ranks import top_rank
from lib_softtrack.statuses import default_status, team_statuses
from lib_softtrack.tables import (
    Comment,
    Sprint,
    Ticket,
    TicketEvent,
    TicketEventField,
    TicketLabelLink,
    Label,
    Project,
    Team,
    User,
    WorkflowStatus,
)
from lib_softtrack.teams import (
    can_be_assigned,
    get_team_or_404,
    require_team_member,
    require_team_writer,
)
from lib_utils.errors import ErrorCode, api_error


@dataclass
class _Move:
    """One ticket's part of a transfer: where each team-owned field goes."""

    ticket: Ticket
    status: WorkflowStatus
    label_ids: list[int]
    labels_kept: list[str]
    labels_dropped: list[str]
    clear_assignee: bool
    detach_parent: bool
    children: list["_Move"] = field(default_factory=list)


def _identifier(session: Session, ticket: Ticket) -> str:
    return f"{session.get(Team, ticket.team_id).key}-{ticket.number}"


def _target_status(
    session: Session,
    ticket: Ticket,
    target_statuses: list[WorkflowStatus],
    target: Team,
) -> WorkflowStatus:
    current = session.get(WorkflowStatus, ticket.status_id)
    for status in target_statuses:
        if status.category == current.category:
            return status
    return default_status(session, target.id)


def _plan_one(
    session: Session,
    ticket: Ticket,
    target: Team,
    target_statuses: list[WorkflowStatus],
    target_labels: dict[str, Label],
    moving_ids: set[int],
) -> _Move:
    current = session.exec(
        select(Label)
        .join(TicketLabelLink, TicketLabelLink.label_id == Label.id)
        .where(TicketLabelLink.ticket_id == ticket.id)
        .order_by(Label.name)
    ).all()
    kept = [
        target_labels[label.name.casefold()]
        for label in current
        if label.name.casefold() in target_labels
    ]
    dropped = [
        label.name for label in current if label.name.casefold() not in target_labels
    ]

    return _Move(
        ticket=ticket,
        status=_target_status(session, ticket, target_statuses, target),
        label_ids=[label.id for label in kept],
        labels_kept=[label.name for label in kept],
        labels_dropped=dropped,
        clear_assignee=(
            ticket.assignee_id is not None
            # A guest there cannot hold it either (#316).
            and not can_be_assigned(target.id, ticket.assignee_id, session)
        ),
        detach_parent=ticket.parent_id is not None
        and ticket.parent_id not in moving_ids,
    )


def _plan(
    session: Session, current_user: User, ticket: Ticket, target_team_id: int
) -> _Move:
    """Check the move is allowed and work out what it does, changing nothing."""
    target = get_team_or_404(target_team_id, session)
    # Write access to both ends: the route's guard covered the ticket's own
    # team; the target is named in the body, so it is checked here.
    require_team_writer(ticket.team_id, current_user, session)
    require_team_writer(target.id, current_user, session)
    if target.id == ticket.team_id:
        raise api_error(
            status_code=400,
            code=ErrorCode.transfer_same_team,
            detail="The ticket is already on that team",
        )

    statuses = team_statuses(session, target.id)
    labels = {
        label.name.casefold(): label
        for label in session.exec(select(Label).where(Label.team_id == target.id)).all()
    }
    children = session.exec(
        select(Ticket).where(Ticket.parent_id == ticket.id).order_by(Ticket.number)
    ).all()
    moving = {ticket.id, *(child.id for child in children)}

    move = _plan_one(session, ticket, target, statuses, labels, moving)
    move.children = [
        _plan_one(session, child, target, statuses, labels, moving)
        for child in children
    ]
    return move


def preview_transfer(
    session: Session, current_user: User, ticket_id: int, target_team_id: int
) -> TransferPlan:
    ticket = get_ticket_or_404(session, ticket_id)
    require_team_member(ticket.team_id, current_user, session)
    move = _plan(session, current_user, ticket, target_team_id)
    target = session.get(Team, target_team_id)
    current_status = session.get(WorkflowStatus, ticket.status_id)
    sprint = session.get(Sprint, ticket.sprint_id) if ticket.sprint_id else None
    project = session.get(Project, ticket.project_id) if ticket.project_id else None
    assignee = session.get(User, ticket.assignee_id) if move.clear_assignee else None
    parent = session.get(Ticket, ticket.parent_id) if move.detach_parent else None

    return TransferPlan(
        from_identifier=_identifier(session, ticket),
        to_identifier=f"{target.key}-{target.next_ticket_number}",
        status=StatusChange(
            from_name=current_status.name,
            to_name=move.status.name,
            same_category=move.status.category == current_status.category,
        ),
        labels_kept=move.labels_kept,
        labels_dropped=move.labels_dropped,
        sprint_cleared=(sprint.name or f"Sprint {sprint.number}") if sprint else None,
        project_cleared=project.name if project else None,
        assignee_cleared=assignee.full_name if assignee else None,
        fields_cleared=custom_fields_service.names_with_values(session, ticket.id),
        parent_detached=_identifier(session, parent) if parent else None,
        sub_tickets=[_identifier(session, child.ticket) for child in move.children],
    )


def _carry_out(session: Session, move: _Move, target: Team, actor: User) -> str:
    """Apply one ticket's move. Returns the key it had, for the comment."""
    ticket = move.ticket
    old_key = _identifier(session, ticket)
    before = snapshot(ticket)

    number = target.next_ticket_number
    target.next_ticket_number = number + 1
    session.add(target)

    ticket.team_id = target.id
    ticket.number = number
    ticket.status_id = move.status.id
    ticket.sprint_id = None
    ticket.project_id = None
    if move.clear_assignee:
        ticket.assignee_id = None
    if move.detach_parent:
        ticket.parent_id = None
    # On top of its new board, where something that just arrived is looked for.
    ticket.rank = top_rank(session, target.id)
    session.add(ticket)
    set_labels(ticket.id, move.label_ids, session)
    custom_fields_service.delete_for_ticket(session, ticket.id)
    session.flush()

    # The fields the reports read -- a cleared sprint has to show up on that
    # sprint's burndown as scope leaving it -- through the same function every
    # other change goes through. They are written under the new team.
    record_changes(session, ticket, before, actor)
    new_key = f"{target.key}-{number}"
    session.add(
        TicketEvent(
            ticket_id=ticket.id,
            team_id=target.id,
            field=TicketEventField.team,
            old_value=old_key,
            new_value=new_key,
            actor_id=actor.id,
        )
    )
    # A comment, not only the event, so the old key is in text that search
    # indexes: somebody pasting ENG-42 from an old chat message finds OPS-17.
    # Written as the person who moved it -- it is a record of what they did --
    # and without notifying anyone: the move is not a message to watchers.
    session.add(
        Comment(ticket_id=ticket.id, author_id=actor.id, body=f"Moved from {old_key}.")
    )
    return old_key


def transfer_ticket(
    session: Session, current_user: User, ticket_id: int, target_team_id: int
) -> TransferResult:
    ticket = get_ticket_or_404(session, ticket_id)
    move = _plan(session, current_user, ticket, target_team_id)
    target = session.get(Team, target_team_id)

    # Into the other team's columns as its limits allow (#270), all of them
    # checked before anything moves: the family goes together or not at all.
    arriving: dict[int, list] = {}
    for part in [move, *move.children]:
        parent_id = None if part.detach_parent or part is move else move.ticket.id
        arriving.setdefault(part.status.id, []).append((None, parent_id))
    for status_id, tickets in arriving.items():
        wip.require_room(session, target.id, status_id, tickets)

    try:
        _carry_out(session, move, target, current_user)
        for child in move.children:
            _carry_out(session, child, target, current_user)
        session.commit()
    except Exception:
        # All of it or none: half a family moved is a parent on one team with
        # children on another, which nothing else in the tracker allows.
        session.rollback()
        raise

    session.refresh(ticket)
    return TransferResult(
        ticket=ticket_to_read(ticket, session),
        sub_tickets=[
            ticket_to_read(session.get(Ticket, child.ticket.id), session)
            for child in move.children
        ],
    )

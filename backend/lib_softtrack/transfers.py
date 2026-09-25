"""Moving an issue to another team (#98).

Issues are numbered per team and most of what hangs off one is per team too,
so a move is not a field change. The rules, which `plan` computes and
`transfer_issue` carries out:

- **Key.** The issue takes the target team's next number. `ENG-42` becomes
  `OPS-17`; the old key cannot be kept, because keys are per team and
  `ENG-42` will never be reused on ENG either. A comment on the issue saying
  "Moved from ENG-42" is what keeps the old key findable in search.
- **Status** maps by category: the target team's first status in the same
  category, or its first column if it has none in that category.
- **Labels** are kept where the target team has one of the same name, ignoring
  case, and dropped otherwise.
- **Cycle** and **project** are cleared; both belong to one team.
- **Assignee** is cleared if they are not on the target team.
- **Parent.** A sub-issue whose parent stays behind becomes top level --
  sub-issues must share a team with their parent.
- **Sub-issues** move with their parent, by the same rules. The alternative,
  refusing the move, turns one action into several and leaves the hierarchy
  broken while it is done by hand.

Everything else stays with the issue because it is keyed by the issue, not
the team: comments, attachments, history, links, watchers, linked branches
and pull requests. Watchers who are not on the target team stop being
notified, the way anybody who leaves a team does.
"""

from dataclasses import dataclass, field
from typing import Optional

from sqlmodel import Session, select

from lib_softtrack.history import record_changes, snapshot
from lib_softtrack.issues import get_issue_or_404, issue_to_read, set_labels
from lib_softtrack.models.transfers import (
    StatusChange,
    TransferPlan,
    TransferResult,
)
from lib_softtrack.ranks import top_rank
from lib_softtrack.statuses import default_status, team_statuses
from lib_softtrack.tables import (
    Comment,
    Cycle,
    Issue,
    IssueEvent,
    IssueEventField,
    IssueLabelLink,
    Label,
    Project,
    Team,
    User,
    WorkflowStatus,
)
from lib_softtrack.teams import (
    get_team_or_404,
    is_team_member,
    require_team_member,
    require_team_writer,
)
from lib_utils.errors import ErrorCode, api_error


@dataclass
class _Move:
    """One issue's part of a transfer: where each team-owned field goes."""

    issue: Issue
    status: WorkflowStatus
    label_ids: list[int]
    labels_kept: list[str]
    labels_dropped: list[str]
    clear_assignee: bool
    detach_parent: bool
    children: list["_Move"] = field(default_factory=list)


def _identifier(session: Session, issue: Issue) -> str:
    return f"{session.get(Team, issue.team_id).key}-{issue.number}"


def _target_status(
    session: Session, issue: Issue, target_statuses: list[WorkflowStatus], target: Team
) -> WorkflowStatus:
    current = session.get(WorkflowStatus, issue.status_id)
    for status in target_statuses:
        if status.category == current.category:
            return status
    return default_status(session, target.id)


def _plan_one(
    session: Session,
    issue: Issue,
    target: Team,
    target_statuses: list[WorkflowStatus],
    target_labels: dict[str, Label],
    moving_ids: set[int],
) -> _Move:
    current = session.exec(
        select(Label)
        .join(IssueLabelLink, IssueLabelLink.label_id == Label.id)
        .where(IssueLabelLink.issue_id == issue.id)
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
        issue=issue,
        status=_target_status(session, issue, target_statuses, target),
        label_ids=[label.id for label in kept],
        labels_kept=[label.name for label in kept],
        labels_dropped=dropped,
        clear_assignee=(
            issue.assignee_id is not None
            and not is_team_member(target.id, issue.assignee_id, session)
        ),
        detach_parent=issue.parent_id is not None and issue.parent_id not in moving_ids,
    )


def _plan(
    session: Session, current_user: User, issue: Issue, target_team_id: int
) -> _Move:
    """Check the move is allowed and work out what it does, changing nothing."""
    target = get_team_or_404(target_team_id, session)
    # Write access to both ends: the route's guard covered the issue's own
    # team; the target is named in the body, so it is checked here.
    require_team_writer(issue.team_id, current_user, session)
    require_team_writer(target.id, current_user, session)
    if target.id == issue.team_id:
        raise api_error(
            status_code=400,
            code=ErrorCode.transfer_same_team,
            detail="The issue is already on that team",
        )

    statuses = team_statuses(session, target.id)
    labels = {
        label.name.casefold(): label
        for label in session.exec(select(Label).where(Label.team_id == target.id)).all()
    }
    children = session.exec(
        select(Issue).where(Issue.parent_id == issue.id).order_by(Issue.number)
    ).all()
    moving = {issue.id, *(child.id for child in children)}

    move = _plan_one(session, issue, target, statuses, labels, moving)
    move.children = [
        _plan_one(session, child, target, statuses, labels, moving)
        for child in children
    ]
    return move


def preview_transfer(
    session: Session, current_user: User, issue_id: int, target_team_id: int
) -> TransferPlan:
    issue = get_issue_or_404(session, issue_id)
    require_team_member(issue.team_id, current_user, session)
    move = _plan(session, current_user, issue, target_team_id)
    target = session.get(Team, target_team_id)
    current_status = session.get(WorkflowStatus, issue.status_id)
    cycle = session.get(Cycle, issue.cycle_id) if issue.cycle_id else None
    project = session.get(Project, issue.project_id) if issue.project_id else None
    assignee = session.get(User, issue.assignee_id) if move.clear_assignee else None
    parent = session.get(Issue, issue.parent_id) if move.detach_parent else None

    return TransferPlan(
        from_identifier=_identifier(session, issue),
        to_identifier=f"{target.key}-{target.next_issue_number}",
        status=StatusChange(
            from_name=current_status.name,
            to_name=move.status.name,
            same_category=move.status.category == current_status.category,
        ),
        labels_kept=move.labels_kept,
        labels_dropped=move.labels_dropped,
        cycle_cleared=(cycle.name or f"Cycle {cycle.number}") if cycle else None,
        project_cleared=project.name if project else None,
        assignee_cleared=assignee.full_name if assignee else None,
        parent_detached=_identifier(session, parent) if parent else None,
        sub_issues=[_identifier(session, child.issue) for child in move.children],
    )


def _carry_out(session: Session, move: _Move, target: Team, actor: User) -> str:
    """Apply one issue's move. Returns the key it had, for the comment."""
    issue = move.issue
    old_key = _identifier(session, issue)
    before = snapshot(issue)

    number = target.next_issue_number
    target.next_issue_number = number + 1
    session.add(target)

    issue.team_id = target.id
    issue.number = number
    issue.status_id = move.status.id
    issue.cycle_id = None
    issue.project_id = None
    if move.clear_assignee:
        issue.assignee_id = None
    if move.detach_parent:
        issue.parent_id = None
    # On top of its new board, where something that just arrived is looked for.
    issue.rank = top_rank(session, target.id)
    session.add(issue)
    set_labels(issue.id, move.label_ids, session)
    session.flush()

    # The fields the reports read -- a cleared cycle has to show up on that
    # cycle's burndown as scope leaving it -- through the same function every
    # other change goes through. They are written under the new team.
    record_changes(session, issue, before, actor)
    new_key = f"{target.key}-{number}"
    session.add(
        IssueEvent(
            issue_id=issue.id,
            team_id=target.id,
            field=IssueEventField.team,
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
        Comment(issue_id=issue.id, author_id=actor.id, body=f"Moved from {old_key}.")
    )
    return old_key


def transfer_issue(
    session: Session, current_user: User, issue_id: int, target_team_id: int
) -> TransferResult:
    issue = get_issue_or_404(session, issue_id)
    move = _plan(session, current_user, issue, target_team_id)
    target = session.get(Team, target_team_id)

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

    session.refresh(issue)
    return TransferResult(
        issue=issue_to_read(issue, session),
        sub_issues=[
            issue_to_read(session.get(Issue, child.issue.id), session)
            for child in move.children
        ],
    )

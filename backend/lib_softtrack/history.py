"""Recording issue history.

Kept separate from the issue service so that "what changed" is written in one
place. Every caller that mutates an issue goes through `record_changes`, which
means a field added later gets history for free by naming it in TRACKED.
"""

from typing import Optional

from sqlmodel import Session, select

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.history import IssueEventRead
from lib_softtrack.tables import (
    Cycle,
    Issue,
    IssueEvent,
    IssueEventField,
    Project,
    User,
    WorkflowStatus,
)
from lib_softtrack.teams import require_team_member
from lib_utils.errors import ErrorCode, api_error

#: The fields worth a history row. The first four are what the reports chart;
#: assignee and priority are what people ask an issue's history about (#81).
#: Title and description changes are noise and would swamp the table; label
#: changes are left out for the same reason.
TRACKED: dict[str, IssueEventField] = {
    "status_id": IssueEventField.status,
    "cycle_id": IssueEventField.cycle,
    "estimate": IssueEventField.estimate,
    "project_id": IssueEventField.project,
    "assignee_id": IssueEventField.assignee,
    "priority": IssueEventField.priority,
    "due_date": IssueEventField.due_date,
}


def _as_text(value: object) -> Optional[str]:
    if value is None:
        return None
    return getattr(value, "value", None) or str(value)


def _status_category(session: Session, status_id: object) -> Optional[str]:
    """A status id, recorded as what it *means* rather than which row it was.

    History outlives the workflow that produced it. A team renames a column,
    merges two, or deletes one and moves the work -- and every chart built
    from these rows has to keep meaning something afterwards. The five
    categories are the only vocabulary that survives all of that, which is
    also why `StatusCategory` is fixed.

    The cost is real and worth stating: a cumulative flow diagram cannot show
    "In Progress" and "In Review" as separate bands, because by the time it is
    drawn both are `started`. Recording the id instead would give sharper
    charts that break the first time somebody tidies up the board.
    """
    if status_id is None:
        return None
    status = session.get(WorkflowStatus, status_id)
    return status.category.value if status else None


def record_creation(session: Session, issue: Issue, actor: Optional[User]) -> None:
    """Write the opening value of every tracked field.

    Without this an issue created straight into `in_progress` looks, to a
    cumulative flow diagram, like it was never anywhere -- there is no event
    saying where it started.
    """
    for attribute, field in TRACKED.items():
        value = getattr(issue, attribute)
        if value is None:
            continue
        session.add(
            IssueEvent(
                issue_id=issue.id,
                team_id=issue.team_id,
                field=field,
                old_value=None,
                new_value=_recorded(session, attribute, value),
                actor_id=actor.id if actor else None,
                opening=True,
            )
        )


def record_changes(
    session: Session, issue: Issue, before: dict[str, object], actor: Optional[User]
) -> None:
    """Write a row for each tracked field whose value actually moved.

    A null `actor` means nobody did it -- an automation rule, which is the one
    caller with no person behind it. `IssueEvent.actor_id` is nullable for
    that case, and attributing the change to whoever tripped the rule would
    put somebody's name on work they did not do.

    `before` is a snapshot taken before the update was applied. Comparing
    values rather than trusting the payload matters: a PATCH that sets status
    to what it already was is not a status change, and counting it would put a
    phantom step in every cumulative flow diagram.
    """
    for attribute, field in TRACKED.items():
        old = before.get(attribute)
        new = getattr(issue, attribute)
        if old == new:
            continue
        recorded_old = _recorded(session, attribute, old)
        recorded_new = _recorded(session, attribute, new)
        # Two statuses in the same category are the same fact to every report
        # reading this table, so moving between them writes no row. An issue
        # dragged from "In Progress" to "In Review" has not changed state.
        if recorded_old == recorded_new:
            continue
        session.add(
            IssueEvent(
                issue_id=issue.id,
                team_id=issue.team_id,
                field=field,
                old_value=recorded_old,
                new_value=recorded_new,
                actor_id=actor.id if actor else None,
            )
        )


def _recorded(session: Session, attribute: str, value: object) -> Optional[str]:
    """What goes in the event row for one tracked field."""
    if attribute == "status_id":
        return _status_category(session, value)
    return _as_text(value)


def snapshot(issue: Issue) -> dict[str, object]:
    """The tracked fields as they are now, for comparison after an update."""
    return {attribute: getattr(issue, attribute) for attribute in TRACKED}


# --- reading it back (#81) ---------------------------------------------------

#: The most events one issue's history returns: the latest ones. An issue
#: with more than this has been through a lot, and the oldest moves are the
#: least likely to be what anybody opened the panel to find.
EVENT_LIMIT = 100


def _labels(session: Session, events: list[IssueEvent]) -> dict[tuple, str]:
    """`{(field, id): name}` for every id an event mentions, one query per kind."""
    ids: dict[IssueEventField, set[int]] = {
        IssueEventField.assignee: set(),
        IssueEventField.cycle: set(),
        IssueEventField.project: set(),
    }
    for event in events:
        if event.field in ids:
            for value in (event.old_value, event.new_value):
                if value is not None and value.isdigit():
                    ids[event.field].add(int(value))

    labels: dict[tuple, str] = {}
    if ids[IssueEventField.assignee]:
        for user in session.exec(
            select(User).where(User.id.in_(ids[IssueEventField.assignee]))
        ):
            labels[(IssueEventField.assignee, user.id)] = user.full_name
    if ids[IssueEventField.cycle]:
        for cycle in session.exec(
            select(Cycle).where(Cycle.id.in_(ids[IssueEventField.cycle]))
        ):
            labels[(IssueEventField.cycle, cycle.id)] = (
                cycle.name or f"Cycle {cycle.number}"
            )
    if ids[IssueEventField.project]:
        for project in session.exec(
            select(Project).where(Project.id.in_(ids[IssueEventField.project]))
        ):
            labels[(IssueEventField.project, project.id)] = project.name
    return labels


def issue_events(
    session: Session, current_user: User, issue_id: int
) -> list[IssueEventRead]:
    """What happened to one issue, oldest first: the changes, not the values it
    was created with (`IssueEvent.opening`), and at most the latest
    EVENT_LIMIT of them."""
    issue = session.get(Issue, issue_id)
    if issue is None:
        raise api_error(
            status_code=404, code=ErrorCode.issue_not_found, detail="Issue not found"
        )
    require_team_member(issue.team_id, current_user, session)

    changes = list(
        session.exec(
            select(IssueEvent)
            .where(
                IssueEvent.issue_id == issue_id, IssueEvent.opening == False
            )  # noqa: E712
            .order_by(IssueEvent.created_at.desc(), IssueEvent.id.desc())
            .limit(EVENT_LIMIT)
        ).all()
    )
    changes.reverse()

    labels = _labels(session, changes)
    actors = {
        user.id: UserPublic.model_validate(user)
        for user in session.exec(
            select(User).where(
                User.id.in_({e.actor_id for e in changes if e.actor_id is not None})
            )
        )
    }

    def label(event: IssueEvent, value: Optional[str]) -> Optional[str]:
        if value is None or not value.isdigit():
            return None
        return labels.get((event.field, int(value)))

    return [
        IssueEventRead(
            id=event.id,
            field=event.field,
            old_value=event.old_value,
            new_value=event.new_value,
            old_label=label(event, event.old_value),
            new_label=label(event, event.new_value),
            actor=actors.get(event.actor_id),
            created_at=event.created_at,
        )
        for event in changes
    ]

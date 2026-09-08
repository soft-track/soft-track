"""Recording issue history.

Kept separate from the issue service so that "what changed" is written in one
place. Every caller that mutates an issue goes through `record_changes`, which
means a field added later gets history for free by naming it in TRACKED.
"""

from typing import Optional

from sqlmodel import Session

from lib_softtrack.tables import (
    Issue,
    IssueEvent,
    IssueEventField,
    User,
    WorkflowStatus,
)

#: The fields worth a history row. Everything here can be charted; title and
#: description changes are noise for reporting and would swamp the table.
TRACKED: dict[str, IssueEventField] = {
    "status_id": IssueEventField.status,
    "cycle_id": IssueEventField.cycle,
    "estimate": IssueEventField.estimate,
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


def record_creation(session: Session, issue: Issue, actor: User) -> None:
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
                actor_id=actor.id,
            )
        )


def record_changes(
    session: Session, issue: Issue, before: dict[str, object], actor: User
) -> None:
    """Write a row for each tracked field whose value actually moved.

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
                actor_id=actor.id,
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

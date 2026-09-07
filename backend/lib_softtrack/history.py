"""Recording issue history.

Kept separate from the issue service so that "what changed" is written in one
place. Every caller that mutates an issue goes through `record_changes`, which
means a field added later gets history for free by naming it in TRACKED.
"""

from typing import Optional

from sqlmodel import Session

from lib_softtrack.tables import Issue, IssueEvent, IssueEventField, User

#: The fields worth a history row. Everything here can be charted; title and
#: description changes are noise for reporting and would swamp the table.
TRACKED: dict[str, IssueEventField] = {
    "status": IssueEventField.status,
    "cycle_id": IssueEventField.cycle,
    "estimate": IssueEventField.estimate,
}


def _as_text(value: object) -> Optional[str]:
    if value is None:
        return None
    return getattr(value, "value", None) or str(value)


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
                new_value=_as_text(value),
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
        session.add(
            IssueEvent(
                issue_id=issue.id,
                team_id=issue.team_id,
                field=field,
                old_value=_as_text(old),
                new_value=_as_text(new),
                actor_id=actor.id,
            )
        )


def snapshot(issue: Issue) -> dict[str, object]:
    """The tracked fields as they are now, for comparison after an update."""
    return {attribute: getattr(issue, attribute) for attribute in TRACKED}

"""What a bug has that a task does not (#273).

A bug is a ticket of type bug, and has three things more: a **severity** --
how bad, as against priority, which is how soon -- an **environment** where
it was seen, and the release it was **found in**. Its fix version (#272) is
where it is fixed. They are built in rather than left to custom fields
(#117) because they come with behaviour: severity is charted, an
environment is one of the team's, and found in points at a release.

**Only a bug is given them.** Setting one on a ticket of another type is
refused, unless the same change makes it a bug. Changing a bug's type keeps
the values -- unshown, and left out of filters, groupings and the report --
so changing it back brings them back.
"""

from typing import Iterable, Optional

from sqlalchemy import and_
from sqlalchemy.sql.elements import ColumnElement

from lib_softtrack.tables import Team, Ticket, TicketType
from lib_utils.errors import ErrorCode, api_error

#: The ticket columns that are a bug's alone.
BUG_FIELDS = ("severity", "environment", "found_in_id")

#: The most environments a team may have, and the longest name of one.
MAX_ENVIRONMENTS = 20
ENVIRONMENT_LENGTH = 40


def require_a_bug(ticket_type: TicketType, data: dict) -> None:
    """Refuse a bug's details on a ticket that will not be a bug.

    Only a value is refused: clearing one is fine on any ticket, so a task
    that was a bug can have its kept severity taken off.
    """
    if ticket_type is TicketType.bug:
        return
    if any(data.get(field) is not None for field in BUG_FIELDS):
        raise api_error(
            status_code=400,
            code=ErrorCode.bug_details_need_a_bug,
            detail="Severity, environment and found in are for bugs. "
            "Make it a bug to give it them.",
        )


def environment_for(team: Team, name: str, keep: Optional[str] = None) -> str:
    """One of the team's environments, in the team's spelling.

    Matched whatever the case, so "production" is the team's "Production".
    `keep` is what the ticket has already: an environment the team has
    since removed stays on the bugs that had it, and may be sent back.
    """
    wanted = name.strip()
    for environment in team.environments or []:
        if environment.casefold() == wanted.casefold():
            return environment
    if keep is not None and keep == wanted:
        return keep
    raise api_error(
        status_code=400,
        code=ErrorCode.environment_not_on_team,
        detail=f"{wanted} is not one of this team's environments.",
    )


def clean_environments(names: Iterable[str]) -> list[str]:
    """A team's list of environments, trimmed, or why it cannot be.

    Blank and repeated names -- whatever the case -- are refused rather than
    quietly dropped: the list is what a bug's environment is checked against,
    and an admin should see the list they saved.
    """
    cleaned: list[str] = []
    for raw in names:
        name = raw.strip()
        if not name or len(name) > ENVIRONMENT_LENGTH:
            raise api_error(
                status_code=422,
                code=ErrorCode.environments_invalid,
                detail=f"An environment needs a name of 1 to {ENVIRONMENT_LENGTH} "
                "characters.",
            )
        if any(other.casefold() == name.casefold() for other in cleaned):
            raise api_error(
                status_code=422,
                code=ErrorCode.environments_invalid,
                detail=f"{name} is in the list twice.",
            )
        cleaned.append(name)
    if len(cleaned) > MAX_ENVIRONMENTS:
        raise api_error(
            status_code=422,
            code=ErrorCode.environments_invalid,
            detail=f"A team has at most {MAX_ENVIRONMENTS} environments.",
        )
    return cleaned


def on_bugs(clause: Optional[ColumnElement[bool]]) -> Optional[ColumnElement[bool]]:
    """A filter on a bug's details, asked of bugs alone.

    "Severity: not trivial" is the bugs that are not trivial, not every task
    on the board as well; and a task that was a bug does not match on the
    severity it kept.
    """
    if clause is None:
        return None
    return and_(Ticket.type == TicketType.bug, clause)

"""WIP limits on board columns (#270).

A status can say how many tickets it should hold at once. What the limit
means is the team's: by default the board warns when a column goes over and
the move goes ahead; with `Team.wip_limits_hard` a move that would take the
column over is refused, with a sentence and `409 wip_limit_reached`. Whether
sub-tickets count against it is the team's too (`wip_counts_subtickets`).

The limit is on the stage, not on what the board happens to show: it counts
every ticket in the status on the team, whatever the board is filtered or
grouped by. Every way a ticket changes status asks `require_room` (or, for
an automation rule, which skips rather than fails, `room`): editing, the
board's drag and drop, bulk edit, creating a ticket into a column, and
moving one to another team. A Jira import loads a team's history as it
was, and deleting a status moves its tickets wherever they must go; neither
is held back by a limit.
"""

from collections.abc import Iterable
from typing import Optional

from sqlmodel import Session, func, select

from lib_softtrack.tables import Team, Ticket, WorkflowStatus
from lib_utils.errors import ErrorCode, api_error

#: A ticket about to arrive in a column: the status it is in now (None for a
#: ticket being created) and its parent, which decides whether it counts.
Arriving = tuple[Optional[int], Optional[int]]


def counts(team: Team) -> list:
    """What counts against a limit on this team: every ticket, or only the
    ones that are not somebody's sub-ticket."""
    return [] if team.wip_counts_subtickets else [Ticket.parent_id.is_(None)]


def held(session: Session, team: Team, status_id: int) -> int:
    """How many tickets in the status count against its limit now."""
    return session.exec(
        select(func.count())
        .select_from(Ticket)
        .where(Ticket.status_id == status_id, *counts(team))
    ).one()


def room(
    session: Session, team_id: int, status_id: int, arriving: Iterable[Arriving]
) -> Optional[str]:
    """None when the tickets fit, or the sentence saying why they do not --
    only where the team makes limits hard. A limit nobody set, a team that
    only warns, and tickets already in the column all fit."""
    status = session.get(WorkflowStatus, status_id)
    if status is None or status.wip_limit is None:
        return None
    team = session.get(Team, team_id)
    if not team.wip_limits_hard:
        return None
    coming = [
        1
        for current, parent_id in arriving
        if current != status_id and (team.wip_counts_subtickets or parent_id is None)
    ]
    if not coming:
        return None
    now = held(session, team, status_id)
    after = now + len(coming)
    if after <= status.wip_limit:
        return None
    if now >= status.wip_limit:
        return (
            f"{status.name} is full. It holds {now}, and this would make {after}. "
            "Finish or move one first."
        )
    return (
        f"{status.name} has a limit of {status.wip_limit}. It holds {now}, and "
        f"this would make {after}."
    )


def require_room(
    session: Session, team_id: int, status_id: int, arriving: Iterable[Arriving]
) -> None:
    """`room`, refusing the move when there is none."""
    reason = room(session, team_id, status_id, arriving)
    if reason is not None:
        raise api_error(
            status_code=409, code=ErrorCode.wip_limit_reached, detail=reason
        )

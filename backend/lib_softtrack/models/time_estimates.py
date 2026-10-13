"""Time estimates in hours, and what is left of them (#268)."""

from typing import Annotated, Optional

from pydantic import BaseModel, Field

#: A thousand hours: more than any one ticket should be, and a bound that
#: stops a typo of minutes for hours turning a sprint total into nonsense.
MAX_ESTIMATE_MINUTES = 1000 * 60

#: How long a ticket was meant to take, in minutes. Null means none.
TimeEstimate = Annotated[
    Optional[int],
    Field(
        ge=1,
        le=MAX_ESTIMATE_MINUTES,
        description="Minutes. Null means no time estimate.",
    ),
]

#: What is left, in minutes, said by hand. Null hands it back to the sum.
Remaining = Annotated[
    Optional[int],
    Field(
        ge=0,
        le=MAX_ESTIMATE_MINUTES,
        description=(
            "Minutes left, set by hand. Null means worked out: the time "
            "estimate less what is logged."
        ),
    ),
]


class TimeTotals(BaseModel):
    """Estimated, logged and remaining minutes over some tickets.

    Logged is every minute logged on them, estimated or not. Remaining is
    over the tickets that have a time estimate or a remaining set by hand,
    and is nothing for a ticket that is done or cancelled.
    """

    estimated_minutes: int
    logged_minutes: int
    remaining_minutes: int


class OverTicket(BaseModel):
    """A ticket that has had more time logged than it was estimated at."""

    id: int
    #: Where it lives, for a link to it: `/{team_key}/ticket/{number}`.
    team_key: str
    number: int
    identifier: str
    title: str
    estimated_minutes: int
    logged_minutes: int
    remaining_minutes: int


class TimeRollup(TimeTotals):
    """A sprint's or an epic's time: its totals, and the tickets that are over."""

    #: Furthest over first.
    over: list[OverTicket]


class TicketTimeEstimate(BaseModel):
    """One ticket's estimate against what is logged on it.

    The ticket's own figures are what logging time on it works from; the
    totals add its sub-tickets, one level deep, and are what its bar shows.
    """

    estimated_minutes: Optional[int] = None
    logged_minutes: int
    #: Worked out, or set by hand; null with neither a time estimate nor a
    #: remaining set by hand. Nothing for a ticket that is done or cancelled.
    remaining_minutes: Optional[int] = None
    #: Whether somebody set remaining by hand. Until then it is worked out.
    remaining_set: bool
    #: With its sub-tickets added. The ticket's own figures when it has none.
    total: TimeTotals
    #: How many sub-tickets are in `total`.
    subticket_count: int

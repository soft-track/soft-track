from datetime import date, datetime
from typing import Annotated, Optional

from pydantic import BaseModel, Field, StringConstraints

from lib_softtrack.tables import ReleaseState

#: "1.4.0": trimmed, and something left after trimming.
ReleaseName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)
]


class ReleaseCreate(BaseModel):
    #: "1.4.0". Unique on the team, as typed.
    name: ReleaseName
    description: Optional[str] = Field(default=None, max_length=2000)
    target_date: Optional[date] = None


class ReleaseUpdate(BaseModel):
    """Every field optional; an explicit null clears the description or the
    target date.

    `state` takes a release out of the pickers (`archived`) and back, or
    reopens a released one (`planned`, which forgets the day it shipped).
    Releasing is `POST /releases/{id}/release`, which asks what to do with
    the tickets that are not done: `released` here is accepted only for a
    release that was released before it was archived.
    """

    name: Optional[ReleaseName] = None
    description: Optional[str] = Field(default=None, max_length=2000)
    target_date: Optional[date] = None
    state: Optional[ReleaseState] = None
    #: Correcting the day it shipped, once it has.
    released_on: Optional[date] = None


class ReleaseProgress(BaseModel):
    """How much of what is in a release is done.

    Cancelled tickets are left out of every number, as they are from a
    parent's sub-ticket progress: they will not ship, and nothing is
    waiting on them. Tickets and points are both given, because they
    disagree -- three of five tickets done with eleven of sixteen points
    says something neither does alone.
    """

    tickets_total: int
    tickets_done: int
    points_total: int
    points_done: int
    #: Tickets in it carrying no points; the point totals are only as honest
    #: as this is small.
    tickets_unestimated: int


class ReleaseRead(BaseModel):
    id: int
    team_id: int
    name: str
    description: Optional[str] = None
    target_date: Optional[date] = None
    state: ReleaseState
    released_on: Optional[date] = None
    progress: ReleaseProgress
    created_at: datetime


class ReleaseRequest(BaseModel):
    """What releasing asks (#272), all of it optional."""

    #: The day it shipped. Defaults to today in UTC; a client sends its own.
    released_on: Optional[date] = None
    #: Where the tickets that are not done go: a planned release on the team,
    #: or null -- the default -- for no release at all.
    move_to_release_id: Optional[int] = None


class ReleaseResult(BaseModel):
    release: ReleaseRead
    #: The tickets that were not done, moved or left without a release.
    moved: int
    #: Where they went; null when they were left without one.
    moved_to_release_id: Optional[int] = None


class ReleaseNotes(BaseModel):
    """A draft of the release notes (#272): markdown for a person to edit.

    Drafted from the done tickets, grouped by type -- stories, then bugs,
    then tasks -- with each ticket's title and key. Nothing keeps it: the
    draft is written fresh each time it is asked for, from what is done now.
    """

    markdown: str

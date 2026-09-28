from datetime import date
from typing import Optional

from pydantic import BaseModel, ConfigDict

from lib_identity.models.departments import DepartmentRef
from lib_identity.models.identity import PersonRef
from lib_softtrack.models.page import Page


class PersonRead(BaseModel):
    """Somebody in the people directory (#125): who they are, where they sit.

    What anyone signed in may read about anyone. No email address: the
    directory is instance-wide, and on an instance open to registration that
    would hand every address to whoever signs up. A team's member list still
    shows its members' addresses to each other, as it always has.
    """

    id: int
    username: str
    full_name: str
    avatar_color: str
    is_active: bool
    job_title: Optional[str] = None
    location: Optional[str] = None
    started_on: Optional[date] = None
    department: Optional[DepartmentRef] = None
    manager: Optional[PersonRef] = None

    model_config = ConfigDict(from_attributes=True)


class SharedTeam(BaseModel):
    """A team on somebody's profile (#126), which the viewer is on too."""

    id: int
    key: str
    name: str

    model_config = ConfigDict(from_attributes=True)


class ProfileRead(PersonRead):
    """Somebody's profile page (#126): their directory row, and around it the
    people they connect to and the teams they share with whoever is looking.

    Resolves for a deactivated account too, marked by `is_active`: tickets
    and comments keep pointing at a person, and the page should not pretend
    otherwise.
    """

    #: The active people whose manager they are, by name.
    direct_reports: list[PersonRef]
    #: The teams they are on that the viewer is on too -- only those. A
    #: stranger's team list says what a team is called and that it exists,
    #: which is why an @mention resolves per team as well.
    shared_teams: list[SharedTeam]


class PeoplePage(Page[PersonRead]):
    #: The manager the list is filtered to, resolved from the username the
    #: request named. A pasted link can then say whose reports these are even
    #: when none of them also match the search.
    manager: Optional[PersonRef] = None

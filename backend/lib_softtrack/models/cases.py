from datetime import datetime
from typing import Annotated, Optional

from pydantic import BaseModel, Field, StringConstraints

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.labels import LabelRead
from lib_softtrack.models.statuses import StatusRead
from lib_softtrack.tables import TestCaseState, TicketType

#: A title: trimmed, and something left after trimming.
CaseTitle = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]
FolderName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)
]

#: The most steps one case has. A case that needs more is two cases.
MAX_STEPS = 50


class TestStep(BaseModel):
    """One numbered step: what to do, and what should happen."""

    __test__ = False

    action: str = Field(max_length=1000)
    expected: str = Field(default="", max_length=1000)


Steps = Annotated[list[TestStep], Field(max_length=MAX_STEPS)]


class TestFolderCreate(BaseModel):
    __test__ = False

    name: FolderName


class TestFolderUpdate(BaseModel):
    __test__ = False

    name: FolderName


class TestFolderRead(BaseModel):
    __test__ = False

    id: int
    team_id: int
    name: str
    #: Cases in it that are not retired.
    case_count: int


class CoveredTicket(BaseModel):
    """A ticket a case covers, as the case lists it."""

    id: int
    identifier: str
    title: str
    type: TicketType
    status: StatusRead


class TestCaseCreate(BaseModel):
    __test__ = False

    title: CaseTitle
    preconditions: Optional[str] = Field(default=None, max_length=20_000)
    steps: Steps = []
    folder_id: Optional[int] = None
    owner_id: Optional[int] = None
    state: TestCaseState = TestCaseState.draft
    label_ids: list[int] = []
    #: The tickets it covers, on this team -- usually the story it is
    #: written for.
    ticket_ids: list[int] = []


class TestCaseUpdate(BaseModel):
    """Every field optional. A change to the title, the preconditions or the
    steps is a new version, which `change_note` can say something about;
    the folder, owner, state and labels change no version."""

    __test__ = False

    title: Optional[CaseTitle] = None
    preconditions: Optional[str] = Field(default=None, max_length=20_000)
    steps: Optional[Steps] = None
    #: An explicit null takes it out of its folder.
    folder_id: Optional[int] = None
    owner_id: Optional[int] = None
    state: Optional[TestCaseState] = None
    label_ids: Optional[list[int]] = None
    change_note: Optional[str] = Field(default=None, max_length=200)


class TestCaseRead(BaseModel):
    __test__ = False

    id: int
    team_id: int
    number: int
    #: "TC-21".
    identifier: str
    title: str
    preconditions: Optional[str] = None
    steps: list[TestStep]
    folder_id: Optional[int] = None
    owner: Optional[UserPublic] = None
    state: TestCaseState
    version: int
    labels: list[LabelRead]
    #: The tickets it covers.
    covers: list[CoveredTicket]
    created_at: datetime
    updated_at: datetime


class TestCaseVersionRead(BaseModel):
    __test__ = False

    version: int
    title: str
    preconditions: Optional[str] = None
    steps: list[TestStep]
    note: Optional[str] = None
    author: Optional[UserPublic] = None
    created_at: datetime


class TestCaseCover(BaseModel):
    __test__ = False

    ticket_id: int


class TicketTestCase(BaseModel):
    """A case that covers a ticket, as the ticket lists it."""

    id: int
    identifier: str
    title: str
    state: TestCaseState


class TicketTestCases(BaseModel):
    """The cases that cover a ticket (#274), and whether its team keeps test
    cases at all -- which is what decides whether a story with none says so."""

    uses_test_cases: bool
    cases: list[TicketTestCase]


class TestCaseHit(BaseModel):
    """A case that search found (#274)."""

    __test__ = False

    id: int
    team_id: int
    team_key: str
    identifier: str
    title: str
    state: TestCaseState
    folder_id: Optional[int] = None


class TestCaseImport(BaseModel):
    """What importing a CSV of test cases did, or would do."""

    __test__ = False

    dry_run: bool
    cases_found: int
    cases_created: int
    #: Rows whose key is a case the team has already: left alone.
    cases_skipped_existing: int
    folders_created: list[str]
    #: Anything a person should read before trusting the result.
    warnings: list[str]

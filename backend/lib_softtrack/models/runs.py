from datetime import datetime
from typing import Annotated, Optional

from pydantic import BaseModel, Field, StringConstraints

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.cases import TestStep
from lib_softtrack.models.statuses import StatusRead
from lib_softtrack.tables import TestResult, TestRunState

RunName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
]


class TestRunCreate(BaseModel):
    """A run of the team's cases (#275): what it is for, where, and which
    cases -- a folder's, a label's and any picked by hand, together. Retired
    cases are left out."""

    __test__ = False

    name: RunName
    release_id: Optional[int] = None
    sprint_id: Optional[int] = None
    project_id: Optional[int] = None
    environment: Optional[str] = Field(default=None, max_length=40)
    owner_id: Optional[int] = None
    folder_id: Optional[int] = None
    label_id: Optional[int] = None
    case_ids: list[int] = []


class TestRunUpdate(BaseModel):
    """Every field optional; an explicit null clears what it is for."""

    __test__ = False

    name: Optional[RunName] = None
    release_id: Optional[int] = None
    sprint_id: Optional[int] = None
    project_id: Optional[int] = None
    environment: Optional[str] = Field(default=None, max_length=40)
    owner_id: Optional[int] = None


class TestRunCasesAdd(BaseModel):
    __test__ = False

    case_ids: list[int] = Field(min_length=1)


class TestRunProgress(BaseModel):
    """How far a run has got: how many passed, failed, were blocked or
    skipped and are not run yet, and how many bugs it raised."""

    __test__ = False

    total: int
    passed: int
    failed: int
    blocked: int
    skipped: int
    not_run: int
    bugs: int


class TestRunRead(BaseModel):
    __test__ = False

    id: int
    team_id: int
    name: str
    release_id: Optional[int] = None
    sprint_id: Optional[int] = None
    project_id: Optional[int] = None
    environment: Optional[str] = None
    owner: Optional[UserPublic] = None
    state: TestRunState
    progress: TestRunProgress
    created_at: datetime
    closed_at: Optional[datetime] = None


class BugRef(BaseModel):
    """The bug a failure raised, as a run lists it."""

    id: int
    identifier: str
    title: str
    status: StatusRead


class TestResultFileRead(BaseModel):
    __test__ = False

    id: int
    filename: str
    content_type: str
    size_bytes: int
    created_at: datetime


class TestRunCaseRead(BaseModel):
    """One case in a run: what was run, by whom, and what happened."""

    __test__ = False

    id: int
    run_id: int
    case_id: int
    #: "TC-22".
    identifier: str
    #: The case's text at the version run.
    version: int
    title: str
    steps: list[TestStep]
    #: The tickets the case covers, by key: what a bug raised from it links to.
    covers: list[str]
    assignee: Optional[UserPublic] = None
    result: Optional[TestResult] = None
    note: Optional[str] = None
    failed_step: Optional[int] = None
    ran_by: Optional[UserPublic] = None
    ran_at: Optional[datetime] = None
    bug: Optional[BugRef] = None
    files: list[TestResultFileRead]


class TestRunDetail(BaseModel):
    __test__ = False

    run: TestRunRead
    cases: list[TestRunCaseRead]


class TestRunCaseUpdate(BaseModel):
    """A result, or who is to run it. Fields left out are left alone; an
    explicit null result is "not run yet" again."""

    __test__ = False

    assignee_id: Optional[int] = None
    result: Optional[TestResult] = None
    note: Optional[str] = Field(default=None, max_length=5000)
    failed_step: Optional[int] = Field(default=None, ge=1)


class CaseRun(BaseModel):
    """A run a case has been in (#275): its history, newest first."""

    run_id: int
    run_name: str
    state: TestRunState
    version: int
    result: Optional[TestResult] = None
    ran_by: Optional[UserPublic] = None
    ran_at: Optional[datetime] = None
    created_at: datetime

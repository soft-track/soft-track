import enum
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from lib_finance.models.money import FinancePerson
from lib_finance.money import MAX_AMOUNT_MINOR, Currency
from lib_identity.models.departments import DepartmentRef
from lib_identity.models.identity import PersonRef
from lib_softtrack.tables import ExpenseState, PayrollRunState, PaySchedule

#: Room for "Hotel, two nights, for the client workshop in Lisbon".
DESCRIPTION_MAX = 200
#: Room for a sentence that says why, and what to do instead.
REASON_MAX = 500


class ReceiptRead(BaseModel):
    filename: str
    content_type: str
    size_bytes: int
    is_image: bool
    #: Where to fetch the bytes, with the caller's token: the submitter's
    #: route or finance's, depending on who is asking.
    url: str


class SettlementKind(str, enum.Enum):
    """How an approved claim is paid back (#137)."""

    batch = "batch"
    payroll_run = "payroll_run"


class Settlement(BaseModel):
    """The batch or payroll run an approved claim goes out on (#137)."""

    kind: SettlementKind
    id: int
    state: PayrollRunState
    #: A run's period and schedule; null for a batch.
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    pay_schedule: Optional[PaySchedule] = None
    paid_at: Optional[datetime] = None
    paid_by: Optional[PersonRef] = None


class ExpenseRead(BaseModel):
    """An expense claim as its submitter sees it (#133).

    Returned by /expenses, which only ever answers with the caller's own
    claims. Who decided and why is on it: a refusal is shown to the person
    it refuses, with its reason.
    """

    id: int
    amount_minor: int
    currency: Currency
    incurred_on: date
    description: str
    state: ExpenseState
    receipt: Optional[ReceiptRead] = None
    decided_by: Optional[PersonRef] = None
    decided_at: Optional[datetime] = None
    refusal_reason: Optional[str] = None
    #: Where an approved claim goes out (#137): null until it is put in a
    #: batch or on a payroll run.
    settlement: Optional[Settlement] = None
    #: When that batch or run was marked paid: the claim is paid back.
    reimbursed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class ExpensePage(BaseModel):
    items: list[ExpenseRead]
    total: int
    limit: int
    offset: int


class ClaimRead(ExpenseRead):
    """An expense claim as finance sees it: whose, and where it belongs."""

    submitter: FinancePerson
    #: The submitter's department now, until approval copies it onto the
    #: claim; the copy after.
    department: Optional[DepartmentRef] = None


class ClaimCounts(BaseModel):
    """How many claims wait in each state, for the queue's tabs."""

    submitted: int
    approved: int
    refused: int


class ClaimPage(BaseModel):
    items: list[ClaimRead]
    total: int
    limit: int
    offset: int
    #: Over the same person filter, whatever the state filter.
    counts: ClaimCounts


class _ClaimFields(BaseModel):
    @field_validator("description", check_fields=False)
    @classmethod
    def _says_what(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and not value.strip():
            raise ValueError("A claim says what the money was for")
        return value.strip() if value is not None else None


class ExpenseCreate(_ClaimFields):
    amount_minor: int = Field(gt=0, le=MAX_AMOUNT_MINOR)
    currency: Currency
    incurred_on: date
    description: str = Field(max_length=DESCRIPTION_MAX)


class ExpenseUpdate(_ClaimFields):
    """Only while the claim waits. Leaving a field out leaves it alone."""

    amount_minor: Optional[int] = Field(default=None, gt=0, le=MAX_AMOUNT_MINOR)
    currency: Optional[Currency] = None
    incurred_on: Optional[date] = None
    description: Optional[str] = Field(default=None, max_length=DESCRIPTION_MAX)


class ExpenseRefusal(BaseModel):
    #: Required: "no" with no why is a Slack thread waiting to happen.
    reason: str = Field(max_length=REASON_MAX)

    @field_validator("reason")
    @classmethod
    def _says_why(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("A refusal says why")
        return value.strip()

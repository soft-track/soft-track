import enum
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from lib_finance.money import MAX_AMOUNT_MINOR, Currency
from lib_identity.models.departments import DepartmentRef
from lib_identity.models.identity import PersonRef
from lib_softtrack.tables import PaySchedule


class BudgetRead(BaseModel):
    id: int
    department: DepartmentRef
    period_start: date
    period_end: date
    amount_minor: int
    currency: Currency
    created_by: PersonRef
    created_at: datetime
    updated_at: datetime


class BudgetRow(BaseModel):
    """One department in one currency over a period: meant, and spent."""

    #: Null for Unattributed: spend approved while its person was in no
    #: department. A row you can see, not a filter -- money filtered out is
    #: money missing from every total.
    department: Optional[DepartmentRef] = None
    currency: Currency
    #: The budget set for exactly this period, if there is one.
    budget: Optional[BudgetRead] = None
    #: Approved payroll lines and reimbursed expenses in the period.
    actual_minor: int


class BudgetOverview(BaseModel):
    period_start: date
    period_end: date
    #: Departments by name, each currency apart; Unattributed last.
    rows: list[BudgetRow]


class _Period(BaseModel):
    @model_validator(mode="after")
    def _runs_forwards(self):
        start, end = getattr(self, "period_start", None), getattr(
            self, "period_end", None
        )
        if start is not None and end is not None and end < start:
            raise ValueError("A period ends on or after the day it starts")
        return self


class BudgetCreate(_Period):
    department_id: int
    period_start: date
    period_end: date
    amount_minor: int = Field(gt=0, le=MAX_AMOUNT_MINOR)
    currency: Currency


class BudgetUpdate(_Period):
    """Leaving a field out leaves it alone."""

    period_start: Optional[date] = None
    period_end: Optional[date] = None
    amount_minor: Optional[int] = Field(default=None, gt=0, le=MAX_AMOUNT_MINOR)


class ActualSourceKind(str, enum.Enum):
    """Where part of an actual comes from."""

    #: Approved lines of one payroll run.
    payroll_run = "payroll_run"
    #: Expense claims paid back in one reimbursement batch.
    reimbursement_batch = "reimbursement_batch"
    #: Expense claims paid back with one payroll run.
    reimbursed_on_run = "reimbursed_on_run"


class ActualSource(BaseModel):
    kind: ActualSourceKind
    #: The run's or the batch's id.
    id: int
    #: A run's period and schedule; null for a batch.
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    pay_schedule: Optional[PaySchedule] = None
    rows: int
    amount_minor: int


class ActualBreakdown(BaseModel):
    """The rows one actual is the sum of (#134)."""

    department: Optional[DepartmentRef] = None
    currency: Currency
    period_start: date
    period_end: date
    total_minor: int
    sources: list[ActualSource]

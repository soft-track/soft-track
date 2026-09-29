from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from lib_finance.models.money import FinancePerson
from lib_finance.money import MAX_AMOUNT_MINOR, Currency
from lib_identity.models.departments import DepartmentRef
from lib_identity.models.identity import PersonRef
from lib_softtrack.tables import PayrollRunState, PaySchedule

#: Room for "On-call, four weekends in September".
ADJUSTMENT_NOTE_MAX = 200


class PayrollRunCreate(BaseModel):
    pay_schedule: PaySchedule
    period_start: date
    period_end: date

    @model_validator(mode="after")
    def _a_period_runs_forwards(self):
        if self.period_end < self.period_start:
            raise ValueError("A period ends on or after the day it starts")
        return self


class PayrollAdjustment(BaseModel):
    """A one-off amount on one line, in the line's currency, and why."""

    #: Positive or negative, never zero: taking an adjustment off is a delete.
    amount_minor: int = Field(ge=-MAX_AMOUNT_MINOR, le=MAX_AMOUNT_MINOR)
    note: str = Field(max_length=ADJUSTMENT_NOTE_MAX)

    @field_validator("amount_minor")
    @classmethod
    def _not_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("An adjustment of nothing is no adjustment")
        return value

    @field_validator("note")
    @classmethod
    def _a_reason(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("An adjustment says why")
        return value.strip()


class PayrollLineRead(BaseModel):
    person: FinancePerson
    #: Where the line's cost belongs: the person's department now, while the
    #: run is a draft, and the one they were in when it was approved after.
    department: Optional[DepartmentRef] = None
    #: The compensation record the amount comes from.
    compensation_id: Optional[int] = None
    #: Pay for the period, before any adjustment. All three null when the
    #: person has no pay in effect: `missing`.
    amount_minor: Optional[int] = None
    currency: Optional[Currency] = None
    total_minor: Optional[int] = None
    #: Zero when there is none.
    adjustment_minor: int
    adjustment_note: Optional[str] = None
    missing: bool


class PayrollReimbursementRead(BaseModel):
    """Approved expense claims paid back on a run (#137), for one person in
    one currency: a line of its own, never merged into the wages -- whoever
    reads the export needs to know which part is pay."""

    person: FinancePerson
    currency: Currency
    amount_minor: int
    claims: int


class PayrollTotal(BaseModel):
    """The lines paid in one currency, summed. Never across currencies."""

    currency: Currency
    amount_minor: int
    lines: int


class PayrollRunSummary(BaseModel):
    id: int
    pay_schedule: PaySchedule
    period_start: date
    period_end: date
    state: PayrollRunState
    created_by: PersonRef
    created_at: datetime
    approved_by: Optional[PersonRef] = None
    approved_at: Optional[datetime] = None
    paid_by: Optional[PersonRef] = None
    paid_at: Optional[datetime] = None
    totals: list[PayrollTotal]
    #: Everybody on the run, the missing included.
    line_count: int
    missing_count: int
    #: Expense claims it carries (#137), per currency, apart from the pay.
    reimbursement_totals: list[PayrollTotal]


class PayrollRunRead(PayrollRunSummary):
    #: Paid lines by name, then the missing ones, by name.
    lines: list[PayrollLineRead]
    #: Claims paid back on the run (#137), by name.
    reimbursements: list[PayrollReimbursementRead]


class PayrollRunPage(BaseModel):
    items: list[PayrollRunSummary]
    total: int
    limit: int
    offset: int

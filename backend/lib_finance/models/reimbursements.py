from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from lib_finance.models.expenses import ClaimRead
from lib_finance.models.money import FinancePerson
from lib_finance.money import Currency
from lib_identity.models.identity import PersonRef
from lib_softtrack.tables import PayrollRunState

#: More claims than anybody gathers by hand; a guard against a runaway client.
MAX_CLAIMS_AT_ONCE = 500


class BatchLine(BaseModel):
    """One person in one currency: what the batch pays them back."""

    person: FinancePerson
    currency: Currency
    amount_minor: int
    claims: int


class BatchTotal(BaseModel):
    currency: Currency
    amount_minor: int
    claims: int


class ReimbursementBatchSummary(BaseModel):
    id: int
    #: "RB-8": how the batch is named in the interface and on the claims.
    label: str
    state: PayrollRunState
    created_by: PersonRef
    created_at: datetime
    approved_by: Optional[PersonRef] = None
    approved_at: Optional[datetime] = None
    paid_by: Optional[PersonRef] = None
    paid_at: Optional[datetime] = None
    #: Per currency, never across.
    totals: list[BatchTotal]
    claim_count: int
    people_count: int


class ReimbursementBatchRead(ReimbursementBatchSummary):
    #: By name, then currency.
    lines: list[BatchLine]
    claims: list[ClaimRead]


class ReimbursementBatchPage(BaseModel):
    items: list[ReimbursementBatchSummary]
    total: int
    limit: int
    offset: int


class ReimbursementBatchCreate(BaseModel):
    expense_ids: list[int] = Field(min_length=1, max_length=MAX_CLAIMS_AT_ONCE)


class ReimbursementCarry(BaseModel):
    """Approved claims to pay back with a draft payroll run's pay."""

    run_id: int
    expense_ids: list[int] = Field(min_length=1, max_length=MAX_CLAIMS_AT_ONCE)

import enum
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from lib_finance.models.money import FinancePerson
from lib_finance.money import MAX_AMOUNT_MINOR, Currency
from lib_identity.models.identity import PersonRef
from lib_softtrack.tables import CompensationKind, PaySchedule

#: Room for "Agreed in the September review, backdated to the promotion".
COMPENSATION_NOTE_MAX = 500


class CompensationStanding(str, enum.Enum):
    """Where a record stands on the day it is read."""

    #: Takes effect later: what they will be paid, not what they are.
    scheduled = "scheduled"
    #: What they are paid now: the latest record in effect.
    current = "current"
    #: In effect once, since replaced by a later record.
    past = "past"
    #: Replaced by a correction, and so never what they were paid.
    corrected = "corrected"


class CompensationRecordRead(BaseModel):
    id: int
    amount_minor: int
    currency: Currency
    pay_schedule: PaySchedule
    effective_on: date
    kind: CompensationKind
    note: Optional[str] = None
    #: The record this one corrects, and the correction that replaced this
    #: one. Each is null when there is none.
    corrects_id: Optional[int] = None
    corrected_by_id: Optional[int] = None
    standing: CompensationStanding
    recorded_by: PersonRef
    created_at: datetime


class CompensationRow(BaseModel):
    """One person on the compensation list."""

    person: FinancePerson
    #: What they are paid today. Null when nothing is in effect: nothing
    #: recorded, or only a start that has not happened yet.
    current: Optional[CompensationRecordRead] = None
    #: How much the current record changed pay from the one before it, in
    #: percent -- only when both are in the same currency on the same
    #: schedule, since anything else would be a conversion.
    change_percent: Optional[float] = None
    #: Records still to take effect, soonest first.
    scheduled: list[CompensationRecordRead]


class CompensationTotal(BaseModel):
    """Current pay summed for one currency on one schedule. Never across
    either: there is no rate to add euros to pounds, or a month to a
    fortnight."""

    currency: Currency
    pay_schedule: PaySchedule
    amount_minor: int
    people: int


class CompensationPage(BaseModel):
    items: list[CompensationRow]
    total: int
    limit: int
    offset: int
    #: Over everybody the filters match, not only this page.
    totals: list[CompensationTotal]
    #: How many of them have no pay in effect: what a payroll run (#132)
    #: will list as missing.
    missing: int


class CompensationHistory(BaseModel):
    person: FinancePerson
    #: Every record, latest effective date first; a correction before the
    #: record it corrects when they share a date.
    records: list[CompensationRecordRead]


class CompensationCreate(BaseModel):
    """A new record. There is no update: a change is another record."""

    amount_minor: int = Field(gt=0, le=MAX_AMOUNT_MINOR)
    currency: Currency
    pay_schedule: PaySchedule
    effective_on: date
    kind: CompensationKind
    note: Optional[str] = Field(default=None, max_length=COMPENSATION_NOTE_MAX)
    #: Required for a correction, and refused for anything else.
    corrects_id: Optional[int] = None

    @model_validator(mode="after")
    def _a_correction_names_what_it_corrects(self):
        if self.kind is CompensationKind.correction and self.corrects_id is None:
            raise ValueError("A correction names the record it corrects")
        if self.kind is not CompensationKind.correction and self.corrects_id:
            raise ValueError("Only a correction names a record to correct")
        return self

from datetime import date
from typing import Optional

from pydantic import BaseModel

from lib_finance.money import Currency


class MonthCost(BaseModel):
    """One currency's approved payroll in one month."""

    currency: Currency
    #: Line totals with their adjustments: the amounts approval froze.
    amount_minor: int
    #: People paid in this currency that month, each once.
    people: int


class PayrollMonth(BaseModel):
    """One calendar month of payroll, as approved (#135)."""

    #: The month's first day.
    month: date
    #: Approved or paid runs whose period ends in the month: the month a
    #: budget counts them in, too (#134).
    runs: int
    #: Runs ending in the month that are still drafts. Not counted and not
    #: projected: the month stays empty until one is approved.
    draft_runs: int
    #: People those runs paid, each once however many runs paid them.
    #: Somebody listed as missing pay was not paid, and is not counted.
    headcount: int
    #: By currency code. Empty while no run ending in the month is approved.
    costs: list[MonthCost]


class PayrollReport(BaseModel):
    """Payroll cost and headcount, month by month (#135)."""

    #: The first day of the month the first approved run ends in: where the
    #: reports begin. Null until a run is approved.
    begins_on: Optional[date]
    #: Oldest first, from `begins_on` or the start of the window asked for,
    #: to this month -- or to a later one an approved run already covers.
    months: list[PayrollMonth]

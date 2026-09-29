"""Finance reports (#135): the past of the money, replayed from real rows.

The issue reports answer questions about the past of the work by replaying
ticket history (lib_softtrack/reports.py). These answer questions about the
past of the money the same way: from rows already written, never from the
current state guessed backwards.

- **Payroll cost** is approved run lines, summed: the amounts approval froze
  (#132), so a raise recorded afterwards cannot redraw a month that was paid.
- **Headcount** is the people those lines paid, month by month -- not
  today's directory counted into the past, which would put this year's
  hires into last year and take out everybody who has left since.
- **Spend by department** is the budget overview (#134), which already adds
  approved lines and reimbursed claims up per department: the report page
  reads it rather than counting a second way, so the two can never disagree.

Months are calendar months, and a run counts in the month its period ends
in, as a budget counts it. A month whose run is still a draft is empty --
not projected, and not carried flat from the month before -- and the months
run no further than this one, or than an approved run already reaches.

Per currency, as everywhere in finance: nothing is converted.
"""

from collections import defaultdict
from datetime import date
from typing import Optional

from sqlalchemy import extract
from sqlmodel import Session, col, func, select

from lib_finance.dates import today
from lib_finance.models.reports import MonthCost, PayrollMonth, PayrollReport
from lib_softtrack.tables import PayrollLine, PayrollRun, PayrollRunState

_YEAR = extract("year", PayrollRun.period_end)
_MONTH = extract("month", PayrollRun.period_end)


def _first_of(day: date) -> date:
    return day.replace(day=1)


def _add_months(month: date, count: int) -> date:
    index = month.year * 12 + month.month - 1 + count
    return date(index // 12, index % 12 + 1, 1)


def payroll(session: Session, months: Optional[int] = None) -> PayrollReport:
    """Approved payroll cost per currency, and the people it paid, by month.

    `months` is how many to show, ending with the latest; None shows every
    month since the first approved run.
    """
    approved = PayrollRun.state != PayrollRunState.draft
    first, last = session.exec(
        select(func.min(PayrollRun.period_end), func.max(PayrollRun.period_end)).where(
            approved
        )
    ).one()
    if first is None:
        return PayrollReport(begins_on=None, months=[])

    begins = _first_of(first)
    until = max(_first_of(today()), _first_of(last))
    start = begins if months is None else max(begins, _add_months(until, 1 - months))
    in_window = (
        PayrollRun.period_end >= start,
        PayrollRun.period_end < _add_months(until, 1),
    )
    paid_lines = (
        select()
        .select_from(PayrollLine)
        .join(PayrollRun, PayrollRun.id == PayrollLine.run_id)
        .where(approved, *in_window, col(PayrollLine.amount_minor).is_not(None))
    )

    def key(year, month) -> date:
        return date(int(year), int(month), 1)

    runs: dict[date, int] = defaultdict(int)
    drafts: dict[date, int] = defaultdict(int)
    for year, month, state, count in session.exec(
        select(_YEAR, _MONTH, PayrollRun.state, func.count())
        .where(*in_window)
        .group_by(_YEAR, _MONTH, PayrollRun.state)
    ):
        if state == PayrollRunState.draft:
            drafts[key(year, month)] += count
        else:
            runs[key(year, month)] += count

    # Distinct people, counted by the database: somebody paid twice in a
    # month -- semi-monthly, or moved between schedules -- is one person.
    headcount = {
        key(year, month): count
        for year, month, count in session.exec(
            paid_lines.add_columns(
                _YEAR, _MONTH, func.count(func.distinct(PayrollLine.user_id))
            ).group_by(_YEAR, _MONTH)
        )
    }
    costs: dict[date, list[MonthCost]] = defaultdict(list)
    for year, month, currency, amount, people in session.exec(
        paid_lines.add_columns(
            _YEAR,
            _MONTH,
            PayrollLine.currency,
            func.sum(PayrollLine.amount_minor + PayrollLine.adjustment_minor),
            func.count(func.distinct(PayrollLine.user_id)),
        )
        .group_by(_YEAR, _MONTH, PayrollLine.currency)
        .order_by(PayrollLine.currency)
    ):
        costs[key(year, month)].append(
            MonthCost(currency=currency, amount_minor=amount, people=people)
        )

    report = PayrollReport(begins_on=begins, months=[])
    month = start
    while month <= until:
        report.months.append(
            PayrollMonth(
                month=month,
                runs=runs[month],
                draft_runs=drafts[month],
                headcount=headcount.get(month, 0),
                costs=costs[month],
            )
        )
        month = _add_months(month, 1)
    return report

"""Department budgets (#134), and actuals computed from real rows.

A budget is what a department meant to spend; the actual beside it is never
typed in. It is summed, in the database, from the rows payroll and expenses
already created:

- **approved payroll lines** -- a run approved or paid, counted in the period
  that holds its last day, at the line's total with its adjustment;
- **reimbursed expenses** -- a claim paid back, in a batch or with a run,
  counted in the period it was spent in.

Each is attributed to the department the person was in **when it was
approved**, which the row copied onto itself then (#132, #133). A reorg in
June moves nobody's January. A row approved while its person was in no
department lands in Unattributed, a row the page shows rather than a filter
that quietly drops money. Draft lines and claims not paid back yet are not
actuals.

Per currency, as everywhere in finance: a department paying in three
currencies has three rows, and nothing is converted.
"""

from collections import defaultdict
from datetime import date
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from sqlmodel import Session, col, func, select

from lib_finance.models.budgets import (
    ActualBreakdown,
    ActualSource,
    ActualSourceKind,
    BudgetCreate,
    BudgetOverview,
    BudgetRead,
    BudgetRow,
    BudgetUpdate,
)
from lib_finance.money import Currency
from lib_identity.departments import require_department
from lib_identity.models.departments import DepartmentRef
from lib_identity.models.identity import PersonRef
from lib_softtrack.tables import (
    Budget,
    Department,
    Expense,
    PayrollLine,
    PayrollRun,
    PayrollRunState,
    User,
    utcnow,
)
from lib_utils.errors import ErrorCode, api_error


def _line_total():
    return PayrollLine.amount_minor + PayrollLine.adjustment_minor


def _approved_lines(start: date, end: date):
    """Payroll lines approved or paid, of runs whose last day is in the period."""
    return (
        select()
        .select_from(PayrollLine)
        .join(PayrollRun, PayrollRun.id == PayrollLine.run_id)
        .where(
            PayrollRun.state != PayrollRunState.draft,
            PayrollRun.period_end >= start,
            PayrollRun.period_end <= end,
            col(PayrollLine.amount_minor).is_not(None),
        )
    )


def _reimbursed(start: date, end: date):
    """Claims paid back, spent in the period."""
    return (
        select()
        .select_from(Expense)
        .where(
            col(Expense.reimbursed_at).is_not(None),
            Expense.incurred_on >= start,
            Expense.incurred_on <= end,
        )
    )


def _actuals(session: Session, start: date, end: date) -> dict[tuple, int]:
    """(department id or None, currency) -> the actual, summed by the database."""
    totals: dict[tuple, int] = defaultdict(int)
    for department_id, currency, amount in session.exec(
        _approved_lines(start, end)
        .add_columns(
            PayrollLine.department_id, PayrollLine.currency, func.sum(_line_total())
        )
        .group_by(PayrollLine.department_id, PayrollLine.currency)
    ):
        totals[(department_id, currency)] += amount
    for department_id, currency, amount in session.exec(
        _reimbursed(start, end)
        .add_columns(
            Expense.department_id, Expense.currency, func.sum(Expense.amount_minor)
        )
        .group_by(Expense.department_id, Expense.currency)
    ):
        totals[(department_id, currency)] += amount
    return totals


def _read(budget: Budget) -> BudgetRead:
    return BudgetRead(
        id=budget.id,
        department=DepartmentRef.model_validate(budget.department),
        period_start=budget.period_start,
        period_end=budget.period_end,
        amount_minor=budget.amount_minor,
        currency=budget.currency,
        created_by=PersonRef.model_validate(budget.created_by),
        created_at=budget.created_at,
        updated_at=budget.updated_at,
    )


def overview(session: Session, start: date, end: date) -> BudgetOverview:
    """Every department with a budget for exactly this period, or spend in
    it, per currency -- and Unattributed, when there is any."""
    actual = _actuals(session, start, end)
    budgets = {
        (budget.department_id, budget.currency): budget
        for budget in session.exec(
            select(Budget)
            .where(Budget.period_start == start, Budget.period_end == end)
            .options(selectinload(Budget.department), selectinload(Budget.created_by))
        )
    }
    keys = set(actual) | set(budgets)
    departments = {
        department.id: department
        for department in session.exec(
            select(Department).where(
                col(Department.id).in_([key[0] for key in keys if key[0]] or [0])
            )
        )
    }

    def order(key):
        department_id, currency = key
        if department_id is None:
            return (1, "", currency)
        return (0, departments[department_id].name.lower(), currency)

    return BudgetOverview(
        period_start=start,
        period_end=end,
        rows=[
            BudgetRow(
                department=(
                    DepartmentRef.model_validate(departments[key[0]])
                    if key[0]
                    else None
                ),
                currency=key[1],
                budget=_read(budgets[key]) if key in budgets else None,
                actual_minor=actual.get(key, 0),
            )
            for key in sorted(keys, key=order)
        ],
    )


def breakdown(
    session: Session,
    start: date,
    end: date,
    currency: Currency,
    department_id: Optional[int],
) -> ActualBreakdown:
    """Where one actual comes from: each run's approved lines and each batch
    of claims paid back, with how many rows and how much. `department_id`
    null is Unattributed."""
    currency = Currency(currency)
    same_department = (
        (lambda column: column == department_id)
        if department_id is not None
        else (lambda column: col(column).is_(None))
    )
    sources: list[ActualSource] = []
    for run_id, period_start, period_end, schedule, rows, amount in session.exec(
        _approved_lines(start, end)
        .add_columns(
            PayrollRun.id,
            PayrollRun.period_start,
            PayrollRun.period_end,
            PayrollRun.pay_schedule,
            func.count(),
            func.sum(_line_total()),
        )
        .where(
            same_department(PayrollLine.department_id),
            PayrollLine.currency == currency.value,
        )
        .group_by(PayrollRun.id)
        .order_by(PayrollRun.period_end, PayrollRun.id)
    ):
        sources.append(
            ActualSource(
                kind=ActualSourceKind.payroll_run,
                id=run_id,
                period_start=period_start,
                period_end=period_end,
                pay_schedule=schedule,
                rows=rows,
                amount_minor=amount,
            )
        )
    claims = session.exec(
        _reimbursed(start, end)
        .add_columns(
            Expense.reimbursement_batch_id,
            Expense.payroll_run_id,
            func.count(),
            func.sum(Expense.amount_minor),
        )
        .where(
            same_department(Expense.department_id), Expense.currency == currency.value
        )
        .group_by(Expense.reimbursement_batch_id, Expense.payroll_run_id)
    ).all()
    runs = {
        run.id: run
        for run in session.exec(
            select(PayrollRun).where(
                col(PayrollRun.id).in_([row[1] for row in claims if row[1]] or [0])
            )
        )
    }
    for batch_id, run_id, rows, amount in sorted(
        claims, key=lambda row: (row[0] is None, row[0] or 0, row[1] or 0)
    ):
        run = runs.get(run_id)
        sources.append(
            ActualSource(
                kind=(
                    ActualSourceKind.reimbursement_batch
                    if batch_id
                    else ActualSourceKind.reimbursed_on_run
                ),
                id=batch_id or run_id,
                period_start=run.period_start if run else None,
                period_end=run.period_end if run else None,
                pay_schedule=run.pay_schedule if run else None,
                rows=rows,
                amount_minor=amount,
            )
        )
    department = session.get(Department, department_id) if department_id else None
    return ActualBreakdown(
        department=DepartmentRef.model_validate(department) if department else None,
        currency=currency,
        period_start=start,
        period_end=end,
        total_minor=sum(source.amount_minor for source in sources),
        sources=sources,
    )


def _budget_or_404(session: Session, budget_id: int) -> Budget:
    budget = session.get(Budget, budget_id)
    if budget is None:
        raise api_error(
            status_code=404, code=ErrorCode.budget_not_found, detail="Budget not found"
        )
    return budget


def _refuse_a_second(session: Session, budget: Budget) -> None:
    other = session.exec(
        select(Budget).where(
            Budget.department_id == budget.department_id,
            Budget.currency == budget.currency,
            Budget.period_start == budget.period_start,
            Budget.period_end == budget.period_end,
            Budget.id != budget.id,
        )
    ).first()
    if other is not None:
        raise api_error(
            status_code=409,
            code=ErrorCode.budget_exists,
            detail=f"{other.department.name} already has a {other.currency} budget "
            "for that period. Change its amount instead",
        )


def _save(session: Session, budget: Budget) -> BudgetRead:
    _refuse_a_second(session, budget)
    session.add(budget)
    try:
        session.commit()
    except IntegrityError:
        # Two at once: the constraint decides.
        session.rollback()
        _refuse_a_second(session, budget)
        raise
    session.refresh(budget)
    return _read(budget)


def create(session: Session, actor: User, payload: BudgetCreate) -> BudgetRead:
    require_department(session, payload.department_id)
    return _save(
        session,
        Budget(
            department_id=payload.department_id,
            period_start=payload.period_start,
            period_end=payload.period_end,
            amount_minor=payload.amount_minor,
            currency=payload.currency.value,
            created_by_id=actor.id,
        ),
    )


def update(session: Session, budget_id: int, payload: BudgetUpdate) -> BudgetRead:
    budget = _budget_or_404(session, budget_id)
    if payload.amount_minor is not None:
        budget.amount_minor = payload.amount_minor
    if payload.period_start is not None:
        budget.period_start = payload.period_start
    if payload.period_end is not None:
        budget.period_end = payload.period_end
    if budget.period_end < budget.period_start:
        raise api_error(
            status_code=400,
            code=ErrorCode.budget_period_invalid,
            detail="A period ends on or after the day it starts",
        )
    budget.updated_at = utcnow()
    return _save(session, budget)


def delete(session: Session, budget_id: int) -> None:
    session.delete(_budget_or_404(session, budget_id))
    session.commit()

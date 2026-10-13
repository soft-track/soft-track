from datetime import date
from typing import Optional

from fastapi import Depends, Query, Response
from sqlmodel import Session

from lib_finance import budgets as budgets_service
from lib_finance.access import finance_router, require_finance_admin
from lib_finance.models.budgets import (
    ActualBreakdown,
    BudgetCreate,
    BudgetOverview,
    BudgetRead,
    BudgetUpdate,
)
from lib_finance.money import Currency
from lib_softtrack.tables import User
from lib_utils.errors import ErrorCode, api_error
from web import get_session

router = finance_router(prefix="/finance/budgets", tags=["budgets"])


def _period(start: date, end: date) -> tuple[date, date]:
    if end < start:
        raise api_error(
            status_code=400,
            code=ErrorCode.budget_period_invalid,
            detail="A period ends on or after the day it starts",
        )
    return start, end


@router.get("", response_model=BudgetOverview)
def get_budget_overview(
    start: date = Query(description="The period's first day"),
    end: date = Query(description="The period's last day"),
    session: Session = Depends(get_session),
):
    """Every department with a budget for exactly this period, or spend in
    it, per currency, beside what it actually spent -- and Unattributed."""
    return budgets_service.overview(session, *_period(start, end))


@router.get("/actuals", response_model=ActualBreakdown)
def get_actual_breakdown(
    start: date = Query(),
    end: date = Query(),
    currency: Currency = Query(),
    department_id: Optional[int] = Query(
        default=None, description="Leave it out for Unattributed"
    ),
    session: Session = Depends(get_session),
):
    """Where one actual comes from: each run's approved lines, and each
    batch or run of claims paid back."""
    return budgets_service.breakdown(
        session, *_period(start, end), currency, department_id
    )


@router.post("", response_model=BudgetRead)
def create_budget(
    payload: BudgetCreate,
    session: Session = Depends(get_session),
    actor: User = Depends(require_finance_admin),
):
    """One per department, period and currency (409 budget_exists)."""
    return budgets_service.create(session, actor, payload)


@router.patch("/{budget_id}", response_model=BudgetRead)
def update_budget(
    budget_id: int, payload: BudgetUpdate, session: Session = Depends(get_session)
):
    return budgets_service.update(session, budget_id, payload)


@router.delete("/{budget_id}", status_code=204)
def delete_budget(budget_id: int, session: Session = Depends(get_session)):
    budgets_service.delete(session, budget_id)
    return Response(status_code=204)

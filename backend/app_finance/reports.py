from typing import Optional

from fastapi import Depends, Query
from sqlmodel import Session

from lib_finance import reports as reports_service
from lib_finance.access import finance_router
from lib_finance.models.reports import PayrollReport
from web import get_session

router = finance_router(prefix="/finance/reports", tags=["finance-reports"])


@router.get("/payroll", response_model=PayrollReport)
def get_payroll_report(
    months: Optional[int] = Query(
        default=None,
        ge=1,
        le=120,
        description="How many months, ending with the latest; leave it out for all",
    ),
    session: Session = Depends(get_session),
):
    """Approved payroll cost per currency, and the people it paid, by month.

    Summed from the lines approval froze, so nothing recorded since can
    redraw a month. Begins with the first approved run and says so in
    `begins_on`; a month whose run is still a draft is empty, never
    projected. Spend by department is GET /finance/budgets.
    """
    return reports_service.payroll(session, months)

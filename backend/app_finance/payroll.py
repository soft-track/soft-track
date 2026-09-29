import csv
import io

from fastapi import Depends, Query, Response
from sqlmodel import Session

from lib_finance import payroll as payroll_service
from lib_finance.access import finance_router, require_finance_admin
from lib_finance.models.payroll import (
    PayrollAdjustment,
    PayrollRunCreate,
    PayrollRunPage,
    PayrollRunRead,
)
from lib_softtrack.models.page import DEFAULT_LIMIT, MAX_LIMIT
from lib_softtrack.tables import User
from lib_utils.spreadsheet import BOM, safe_text
from web import get_session

router = finance_router(prefix="/finance/payroll/runs", tags=["payroll"])


@router.get("", response_model=PayrollRunPage)
def list_payroll_runs(
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
):
    """Every run, the newest period first, with its totals per currency."""
    return payroll_service.list_runs(session, limit=limit, offset=offset)


@router.post("", response_model=PayrollRunRead)
def create_payroll_run(
    payload: PayrollRunCreate,
    session: Session = Depends(get_session),
    actor: User = Depends(require_finance_admin),
):
    """Generate a draft run for one period on one pay schedule. Refused when
    another run on that schedule covers any of the same days."""
    return payroll_service.create_run(session, actor, payload)


@router.get("/{run_id}", response_model=PayrollRunRead)
def get_payroll_run(run_id: int, session: Session = Depends(get_session)):
    """A run and its lines: live while it is a draft, as approved after."""
    return payroll_service.get_run(session, run_id)


@router.delete("/{run_id}", status_code=204)
def delete_payroll_run(run_id: int, session: Session = Depends(get_session)):
    """Throw away a draft. An approved run is a record, and stays."""
    payroll_service.delete_run(session, run_id)
    return Response(status_code=204)


@router.put("/{run_id}/lines/{user_id}/adjustment", response_model=PayrollRunRead)
def set_payroll_adjustment(
    run_id: int,
    user_id: int,
    payload: PayrollAdjustment,
    session: Session = Depends(get_session),
):
    """A one-off amount on somebody's line, in its currency, with a note."""
    return payroll_service.set_adjustment(session, run_id, user_id, payload)


@router.delete("/{run_id}/lines/{user_id}/adjustment", response_model=PayrollRunRead)
def clear_payroll_adjustment(
    run_id: int, user_id: int, session: Session = Depends(get_session)
):
    return payroll_service.clear_adjustment(session, run_id, user_id)


@router.post("/{run_id}/approve", response_model=PayrollRunRead)
def approve_payroll_run(
    run_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(require_finance_admin),
):
    """Freeze the run: every line written with its amount, currency, record
    and department, so nothing recorded later can change what it paid."""
    return payroll_service.approve(session, actor, run_id)


@router.post("/{run_id}/paid", response_model=PayrollRunRead)
def mark_payroll_run_paid(
    run_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(require_finance_admin),
):
    return payroll_service.mark_paid(session, actor, run_id)


@router.get(
    "/{run_id}/export",
    response_class=Response,
    responses={200: {"content": {"text/csv": {}}}},
)
def export_payroll_run(run_id: int, session: Session = Depends(get_session)):
    """The approved run as CSV -- name, amount, currency and the period --
    shaped for a bank template or a payroll bureau. Missing lines are not in
    it: there is nothing to pay them."""
    run, rows = payroll_service.export_rows(session, run_id)
    buffer = io.StringIO()
    buffer.write(BOM)
    writer = csv.writer(buffer, lineterminator="\r\n", quoting=csv.QUOTE_MINIMAL)
    for row in rows:
        writer.writerow([safe_text(cell) for cell in row])
    filename = (
        f"payroll-{run.period_start.isoformat()}-"
        f"{run.pay_schedule.value.replace('_', '-')}.csv"
    )
    return Response(
        content=buffer.getvalue().encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

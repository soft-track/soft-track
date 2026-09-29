import csv
import io

from fastapi import Depends, Query, Response
from sqlmodel import Session

from lib_finance import reimbursements as reimbursements_service
from lib_finance.access import finance_router, require_finance_admin
from lib_finance.models.expenses import ClaimRead
from lib_finance.models.payroll import PayrollRunRead
from lib_finance.models.reimbursements import (
    ReimbursementBatchCreate,
    ReimbursementBatchPage,
    ReimbursementBatchRead,
    ReimbursementCarry,
)
from lib_softtrack.models.page import DEFAULT_LIMIT, MAX_LIMIT
from lib_softtrack.tables import User
from lib_utils.spreadsheet import BOM, safe_text
from web import get_session

router = finance_router(prefix="/finance/reimbursements", tags=["reimbursements"])


@router.get("/awaiting", response_model=list[ClaimRead])
def list_awaiting_reimbursement(session: Session = Depends(get_session)):
    """Every approved claim not paid back yet, the longest waiting first.
    Those already in a draft batch or on a draft run say where."""
    return reimbursements_service.awaiting(session)


@router.post("/carry", response_model=PayrollRunRead)
def carry_on_payroll_run(
    payload: ReimbursementCarry, session: Session = Depends(get_session)
):
    """Pay approved claims back with a draft payroll run, each person's as a
    line of its own beside their pay."""
    return reimbursements_service.carry(session, payload.run_id, payload.expense_ids)


@router.delete("/expenses/{expense_id}/settlement", response_model=ClaimRead)
def release_expense(expense_id: int, session: Session = Depends(get_session)):
    """Take a claim back out of a draft batch or off a draft run."""
    return reimbursements_service.release(session, expense_id)


@router.get("/batches", response_model=ReimbursementBatchPage)
def list_reimbursement_batches(
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
):
    return reimbursements_service.list_batches(session, limit=limit, offset=offset)


@router.post("/batches", response_model=ReimbursementBatchRead)
def create_reimbursement_batch(
    payload: ReimbursementBatchCreate,
    session: Session = Depends(get_session),
    actor: User = Depends(require_finance_admin),
):
    """Gather approved claims, none already going out, into a draft batch."""
    return reimbursements_service.create_batch(session, actor, payload.expense_ids)


@router.get("/batches/{batch_id}", response_model=ReimbursementBatchRead)
def get_reimbursement_batch(batch_id: int, session: Session = Depends(get_session)):
    return reimbursements_service.get_batch(session, batch_id)


@router.delete("/batches/{batch_id}", status_code=204)
def delete_reimbursement_batch(batch_id: int, session: Session = Depends(get_session)):
    """Throw a draft batch away; its claims go back to awaiting."""
    reimbursements_service.delete_batch(session, batch_id)
    return Response(status_code=204)


@router.post("/batches/{batch_id}/approve", response_model=ReimbursementBatchRead)
def approve_reimbursement_batch(
    batch_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(require_finance_admin),
):
    return reimbursements_service.approve_batch(session, actor, batch_id)


@router.post("/batches/{batch_id}/paid", response_model=ReimbursementBatchRead)
def mark_reimbursement_batch_paid(
    batch_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(require_finance_admin),
):
    """Say the money went out: every claim in the batch is paid back now."""
    return reimbursements_service.mark_batch_paid(session, actor, batch_id)


@router.get(
    "/batches/{batch_id}/export",
    response_class=Response,
    responses={200: {"content": {"text/csv": {}}}},
)
def export_reimbursement_batch(batch_id: int, session: Session = Depends(get_session)):
    """The approved batch in the payroll CSV's shape: one row per person per
    currency, over the days the claims were spent."""
    batch, rows = reimbursements_service.batch_export_rows(session, batch_id)
    buffer = io.StringIO()
    buffer.write(BOM)
    writer = csv.writer(buffer, lineterminator="\r\n", quoting=csv.QUOTE_MINIMAL)
    for row in rows:
        writer.writerow([safe_text(cell) for cell in row])
    filename = f"reimbursements-{reimbursements_service.label(batch.id).lower()}.csv"
    return Response(
        content=buffer.getvalue().encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

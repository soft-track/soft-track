from typing import Optional

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from lib_finance import expenses as expenses_service
from lib_finance.access import finance_router, require_finance_admin
from lib_finance.models.expenses import (
    ClaimPage,
    ClaimRead,
    ExpenseCreate,
    ExpensePage,
    ExpenseRead,
    ExpenseRefusal,
    ExpenseUpdate,
)
from lib_identity.identity import get_current_user
from lib_softtrack import attachments
from lib_softtrack.models.page import DEFAULT_LIMIT, MAX_LIMIT
from lib_softtrack.storage import ObjectNotFound, Storage, copy_stream, get_storage
from lib_softtrack.tables import Expense, ExpenseState, User
from lib_utils.errors import ErrorCode, api_error
from web import get_session, settings

# Your own claims: anyone signed in, and only ever their own.
router = APIRouter(prefix="/expenses", tags=["expenses"])
# Everybody's, for finance to decide.
finance = finance_router(prefix="/finance/expenses", tags=["expense-claims"])


def _receipt_response(storage: Storage, expense: Expense) -> StreamingResponse:
    """The receipt's bytes, served the way attachments are: the derived type,
    inline for an image or PDF, and nothing a browser may run."""
    try:
        body = storage.open(expense.receipt_storage_key)
    except ObjectNotFound:
        raise api_error(
            status_code=410,
            code=ErrorCode.attachment_gone,
            detail="That file is no longer stored.",
        )
    return StreamingResponse(
        copy_stream(body),
        media_type=expense.receipt_content_type,
        headers={
            "Content-Disposition": attachments.content_disposition_for(
                expense.receipt_filename, expense.receipt_content_type
            ),
            "Content-Length": str(expense.receipt_size_bytes),
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )


@router.get("", response_model=ExpensePage)
def list_my_expenses(
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Your own claims, the latest spent first. Nobody else's, whoever asks:
    an expense says where somebody was and what they bought."""
    return expenses_service.list_own(session, user, limit=limit, offset=offset)


@router.post("", response_model=ExpenseRead)
def submit_expense(
    payload: ExpenseCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Claim money you spent for work. The receipt is attached next, with
    PUT /expenses/{id}/receipt."""
    return expenses_service.create(session, user, payload)


@router.patch("/{expense_id}", response_model=ExpenseRead)
def update_expense(
    expense_id: int,
    payload: ExpenseUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Change a claim that is still waiting. A decided one is a record."""
    return expenses_service.update(session, user, expense_id, payload)


@router.delete("/{expense_id}", status_code=204)
def withdraw_expense(
    expense_id: int,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
    user: User = Depends(get_current_user),
):
    """Withdraw a claim that is still waiting, receipt and all."""
    expenses_service.withdraw(session, storage, user, expense_id)
    return Response(status_code=204)


@router.put("/{expense_id}/receipt", response_model=ExpenseRead)
async def attach_receipt(
    expense_id: int,
    file: UploadFile = File(..., description="A photo or PDF of the receipt."),
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
    user: User = Depends(get_current_user),
):
    """Attach the receipt, or replace it: an image or a PDF, checked the way
    ticket attachments are."""
    limit = settings.attachment_max_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise api_error(
            status_code=413,
            code=ErrorCode.file_too_large,
            detail=f"That file is larger than {limit // (1024 * 1024)}MB.",
        )
    return expenses_service.attach_receipt(
        session, storage, user, expense_id, file.filename or "", data
    )


@router.delete("/{expense_id}/receipt", response_model=ExpenseRead)
def remove_receipt(
    expense_id: int,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
    user: User = Depends(get_current_user),
):
    return expenses_service.remove_receipt(session, storage, user, expense_id)


@router.get("/{expense_id}/receipt")
def download_my_receipt(
    expense_id: int,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
    user: User = Depends(get_current_user),
):
    return _receipt_response(
        storage, expenses_service.own_receipt(session, user, expense_id)
    )


@finance.get("", response_model=ClaimPage)
def list_expense_claims(
    state: Optional[ExpenseState] = Query(default=None),
    submitter_id: Optional[int] = Query(default=None),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
):
    """Every claim, the latest spent first, with how many are in each state."""
    return expenses_service.list_claims(
        session, state=state, submitter_id=submitter_id, limit=limit, offset=offset
    )


@finance.get("/{expense_id}", response_model=ClaimRead)
def get_expense_claim(expense_id: int, session: Session = Depends(get_session)):
    return expenses_service.get_claim(session, expense_id)


@finance.get("/{expense_id}/receipt")
def download_claim_receipt(
    expense_id: int,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
):
    return _receipt_response(
        storage, expenses_service.claim_receipt(session, expense_id)
    )


@finance.post("/{expense_id}/approve", response_model=ClaimRead)
def approve_expense(
    expense_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(require_finance_admin),
):
    """Approve a waiting claim. Refused for your own: another finance admin
    decides it."""
    return expenses_service.approve(session, actor, expense_id)


@finance.post("/{expense_id}/refuse", response_model=ClaimRead)
def refuse_expense(
    expense_id: int,
    payload: ExpenseRefusal,
    session: Session = Depends(get_session),
    actor: User = Depends(require_finance_admin),
):
    """Refuse a waiting claim, saying why. The submitter sees the reason."""
    return expenses_service.refuse(session, actor, expense_id, payload.reason)

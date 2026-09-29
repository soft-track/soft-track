"""Expense claims (#133): money spent for work, and the decision about it.

The one finance feature everybody touches: buy the thing, keep the receipt,
get paid back. Two sides, and a wall between them:

- **The submitter** sees their own claims and nobody else's -- an expense says
  where you were and what you bought. They can change or withdraw a claim
  while it waits.
- **Finance** sees every claim and decides: approved, or refused with a
  reason. Not the manager chain, which stays information (#124); and not the
  claim's own submitter, even with finance access -- nobody approves their own
  expenses. What happens to an approved claim next is reimbursement (#137).

A decided claim is frozen. A correction is a new claim, the same instinct as
compensation's append-only history.
"""

import hashlib
from datetime import timedelta
from typing import Optional

from sqlalchemy.orm import selectinload
from sqlmodel import Session, col, func, select

from lib_finance.dates import today
from lib_finance.models.expenses import (
    ClaimCounts,
    ClaimPage,
    ClaimRead,
    ExpenseCreate,
    ExpensePage,
    ExpenseRead,
    ExpenseUpdate,
    ReceiptRead,
)
from lib_finance.models.money import FinancePerson
from lib_identity.models.departments import DepartmentRef
from lib_identity.models.identity import PersonRef
from lib_softtrack import attachments
from lib_softtrack.models.page import DEFAULT_LIMIT
from lib_softtrack.storage import Storage
from lib_softtrack.tables import Expense, ExpenseState, User, utcnow
from lib_utils.errors import ErrorCode, api_error

#: What a receipt may be: a photo or a PDF, and nothing else the attachment
#: pipeline accepts -- a receipt is not a zip file.
RECEIPT_TYPES = {
    extension: content_type
    for extension, content_type in attachments.ALLOWED_TYPES.items()
    if content_type in attachments.IMAGE_TYPES or content_type == "application/pdf"
}

#: A claim dated tomorrow is allowed for somebody a timezone ahead of the
#: server; anything later is money not spent yet.
_TIMEZONE_SLACK = timedelta(days=1)


def _receipt(expense: Expense, url: str) -> Optional[ReceiptRead]:
    if expense.receipt_storage_key is None:
        return None
    # The browser keeps what it fetched by URL, and a replaced receipt is
    # the same claim's: the version is what makes the new file a new URL.
    version = hashlib.sha256(expense.receipt_storage_key.encode()).hexdigest()[:12]
    return ReceiptRead(
        filename=expense.receipt_filename,
        content_type=expense.receipt_content_type,
        size_bytes=expense.receipt_size_bytes,
        is_image=expense.receipt_content_type in attachments.IMAGE_TYPES,
        url=f"{url}?v={version}",
    )


def _fields(expense: Expense, receipt_url: str) -> dict:
    return {
        "id": expense.id,
        "amount_minor": expense.amount_minor,
        "currency": expense.currency,
        "incurred_on": expense.incurred_on,
        "description": expense.description,
        "state": expense.state,
        "receipt": _receipt(expense, receipt_url),
        "decided_by": (
            PersonRef.model_validate(expense.decided_by) if expense.decided_by else None
        ),
        "decided_at": expense.decided_at,
        "refusal_reason": expense.refusal_reason,
        "created_at": expense.created_at,
        "updated_at": expense.updated_at,
    }


def _own(expense: Expense) -> ExpenseRead:
    return ExpenseRead(**_fields(expense, f"/expenses/{expense.id}/receipt"))


def _claim(expense: Expense) -> ClaimRead:
    submitter = expense.submitter
    department = (
        expense.department
        if expense.state is ExpenseState.approved
        else submitter.department
    )
    return ClaimRead(
        **_fields(expense, f"/finance/expenses/{expense.id}/receipt"),
        submitter=FinancePerson.model_validate(submitter),
        department=DepartmentRef.model_validate(department) if department else None,
    )


def _not_found() -> Exception:
    return api_error(
        status_code=404,
        code=ErrorCode.expense_not_found,
        detail="Expense claim not found",
    )


def _refuse_a_decided(expense: Expense) -> None:
    if expense.state is not ExpenseState.submitted:
        raise api_error(
            status_code=409,
            code=ErrorCode.expense_decided,
            detail=(
                f"This claim has been {expense.state.value}, and a decided claim "
                "does not change. Submit a new one to correct it."
            ),
        )


def _refuse_the_future(incurred_on) -> None:
    if incurred_on > today() + _TIMEZONE_SLACK:
        raise api_error(
            status_code=400,
            code=ErrorCode.expense_in_future,
            detail="A claim is for money already spent, so its date has passed",
        )


# --- The submitter's own claims ----------------------------------------------


def _own_or_404(session: Session, user: User, expense_id: int) -> Expense:
    """The caller's claim. Somebody else's is not found, not forbidden: that
    it exists is none of the caller's business either."""
    expense = session.get(Expense, expense_id)
    if expense is None or expense.submitter_id != user.id:
        raise _not_found()
    return expense


def list_own(
    session: Session, user: User, limit: int = DEFAULT_LIMIT, offset: int = 0
) -> ExpensePage:
    filters = [Expense.submitter_id == user.id]
    total = session.exec(
        select(func.count()).select_from(Expense).where(*filters)
    ).one()
    rows = session.exec(
        select(Expense)
        .where(*filters)
        .options(selectinload(Expense.decided_by))
        .order_by(col(Expense.incurred_on).desc(), col(Expense.id).desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return ExpensePage(
        items=[_own(row) for row in rows], total=total, limit=limit, offset=offset
    )


def create(session: Session, user: User, payload: ExpenseCreate) -> ExpenseRead:
    _refuse_the_future(payload.incurred_on)
    expense = Expense(
        submitter_id=user.id,
        amount_minor=payload.amount_minor,
        currency=payload.currency.value,
        incurred_on=payload.incurred_on,
        description=payload.description,
    )
    session.add(expense)
    session.commit()
    session.refresh(expense)
    return _own(expense)


def update(
    session: Session, user: User, expense_id: int, payload: ExpenseUpdate
) -> ExpenseRead:
    expense = _own_or_404(session, user, expense_id)
    _refuse_a_decided(expense)
    if payload.incurred_on is not None:
        _refuse_the_future(payload.incurred_on)
        expense.incurred_on = payload.incurred_on
    if payload.amount_minor is not None:
        expense.amount_minor = payload.amount_minor
    if payload.currency is not None:
        expense.currency = payload.currency.value
    if payload.description is not None:
        expense.description = payload.description
    expense.updated_at = utcnow()
    session.add(expense)
    session.commit()
    session.refresh(expense)
    return _own(expense)


def withdraw(session: Session, storage: Storage, user: User, expense_id: int) -> None:
    """Take back a claim nobody has decided yet, receipt and all. Rows first,
    bytes after the commit, as with attachments: a stray file costs disk, a
    row promising a missing file costs a broken receipt."""
    expense = _own_or_404(session, user, expense_id)
    _refuse_a_decided(expense)
    key = expense.receipt_storage_key
    session.delete(expense)
    session.commit()
    if key:
        attachments.purge(storage, [key])


def attach_receipt(
    session: Session,
    storage: Storage,
    user: User,
    expense_id: int,
    raw_filename: str,
    data: bytes,
) -> ExpenseRead:
    """Attach the receipt, or replace the one there."""
    expense = _own_or_404(session, user, expense_id)
    _refuse_a_decided(expense)
    filename, content_type = attachments.check_upload(raw_filename, data, RECEIPT_TYPES)

    key = attachments.new_storage_key(filename)
    storage.write(key, data)
    previous = expense.receipt_storage_key
    expense.receipt_filename = filename
    expense.receipt_content_type = content_type
    expense.receipt_size_bytes = len(data)
    expense.receipt_storage_key = key
    expense.updated_at = utcnow()
    session.add(expense)
    try:
        session.commit()
    except Exception:
        session.rollback()
        storage.delete(key)
        raise
    if previous:
        attachments.purge(storage, [previous])
    session.refresh(expense)
    return _own(expense)


def remove_receipt(
    session: Session, storage: Storage, user: User, expense_id: int
) -> ExpenseRead:
    expense = _own_or_404(session, user, expense_id)
    _refuse_a_decided(expense)
    key = expense.receipt_storage_key
    expense.receipt_filename = None
    expense.receipt_content_type = None
    expense.receipt_size_bytes = None
    expense.receipt_storage_key = None
    expense.updated_at = utcnow()
    session.add(expense)
    session.commit()
    if key:
        attachments.purge(storage, [key])
    session.refresh(expense)
    return _own(expense)


def _with_receipt(expense: Expense) -> Expense:
    if expense.receipt_storage_key is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.receipt_not_found,
            detail="This claim has no receipt",
        )
    return expense


def own_receipt(session: Session, user: User, expense_id: int) -> Expense:
    return _with_receipt(_own_or_404(session, user, expense_id))


# --- Finance's side: every claim, and the decision -------------------------------


def _claim_or_404(session: Session, expense_id: int) -> Expense:
    expense = session.get(Expense, expense_id)
    if expense is None:
        raise _not_found()
    return expense


def list_claims(
    session: Session,
    state: Optional[ExpenseState] = None,
    submitter_id: Optional[int] = None,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
) -> ClaimPage:
    """Every claim, the latest spent first, filtered by state and person."""
    people = [Expense.submitter_id == submitter_id] if submitter_id else []
    filters = [*people, *([Expense.state == state] if state else [])]
    total = session.exec(
        select(func.count()).select_from(Expense).where(*filters)
    ).one()
    rows = session.exec(
        select(Expense)
        .where(*filters)
        .options(
            selectinload(Expense.submitter).selectinload(User.department),
            selectinload(Expense.decided_by),
            selectinload(Expense.department),
        )
        .order_by(col(Expense.incurred_on).desc(), col(Expense.id).desc())
        .limit(limit)
        .offset(offset)
    ).all()
    counts = dict(
        session.exec(
            select(Expense.state, func.count()).where(*people).group_by(Expense.state)
        ).all()
    )
    return ClaimPage(
        items=[_claim(row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
        counts=ClaimCounts(**{s.value: counts.get(s, 0) for s in ExpenseState}),
    )


def get_claim(session: Session, expense_id: int) -> ClaimRead:
    return _claim(_claim_or_404(session, expense_id))


def claim_receipt(session: Session, expense_id: int) -> Expense:
    return _with_receipt(_claim_or_404(session, expense_id))


def _decide(
    session: Session,
    actor: User,
    expense_id: int,
    state: ExpenseState,
    reason: Optional[str] = None,
) -> ClaimRead:
    expense = _claim_or_404(session, expense_id)
    _refuse_a_decided(expense)
    if expense.submitter_id == actor.id:
        raise api_error(
            status_code=409,
            code=ErrorCode.expense_own_claim,
            detail="Nobody decides their own claim. Another finance admin does.",
        )
    now = utcnow()
    expense.state = state
    expense.decided_by_id = actor.id
    expense.decided_at = now
    expense.updated_at = now
    if state is ExpenseState.approved:
        # Where the cost belongs, as of the decision (#134).
        expense.department_id = expense.submitter.department_id
    else:
        expense.refusal_reason = reason
    session.add(expense)
    session.commit()
    session.refresh(expense)
    return _claim(expense)


def approve(session: Session, actor: User, expense_id: int) -> ClaimRead:
    return _decide(session, actor, expense_id, ExpenseState.approved)


def refuse(session: Session, actor: User, expense_id: int, reason: str) -> ClaimRead:
    return _decide(session, actor, expense_id, ExpenseState.refused, reason)

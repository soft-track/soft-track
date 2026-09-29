from typing import Optional

from fastapi import Depends, Query
from sqlmodel import Session

from lib_finance import compensation as compensation_service
from lib_finance.access import finance_router, require_finance_admin
from lib_finance.models.compensation import (
    CompensationCreate,
    CompensationHistory,
    CompensationPage,
    CompensationRecordRead,
)
from lib_finance.money import Currency
from lib_softtrack.models.page import DEFAULT_LIMIT, MAX_LIMIT
from lib_softtrack.tables import User
from web import get_session

router = finance_router(prefix="/finance/compensation", tags=["compensation"])


@router.get("", response_model=CompensationPage)
def list_compensation(
    q: Optional[str] = Query(default=None, description="Search name or username"),
    department_id: Optional[int] = Query(default=None),
    currency: Optional[Currency] = Query(
        default=None, description="Only people currently paid in this currency"
    ),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
):
    """Everybody active and what they are paid today, with totals per currency
    and pay schedule over everybody the filters match. People with nothing in
    effect come last, and are counted in `missing`."""
    return compensation_service.list_compensation(
        session,
        compensation_service.today(),
        q=q,
        department_id=department_id,
        currency=currency,
        limit=limit,
        offset=offset,
    )


@router.get("/{username}", response_model=CompensationHistory)
def get_compensation_history(username: str, session: Session = Depends(get_session)):
    """Every record somebody has, latest effective first, each marked
    scheduled, current, past or corrected."""
    return compensation_service.history(session, username, compensation_service.today())


@router.post("/{username}", response_model=CompensationRecordRead)
def record_compensation(
    username: str,
    payload: CompensationCreate,
    session: Session = Depends(get_session),
    actor: User = Depends(require_finance_admin),
):
    """Record a decision about somebody's pay. A raise or a correction is a
    new record; nothing is edited or deleted."""
    return compensation_service.record(
        session, actor, username, payload, compensation_service.today()
    )

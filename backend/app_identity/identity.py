from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session

from lib_identity.identity import get_current_user, login_user, register_user
from lib_identity.models.identity import Token, UserCreate, UserPublic
from lib_softtrack.tables import User
from lib_utils.rate_limit import (
    address_of,
    login_by_account,
    login_by_address,
    registration_by_address,
)
from web import get_session

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=Token)
def register(
    request: Request, payload: UserCreate, session: Session = Depends(get_session)
):
    address = address_of(request)
    registration_by_address.raise_if_locked(address)
    # Charged before the attempt, and never forgiven: a successful signup
    # spends budget too, because bulk registration is the thing being limited.
    registration_by_address.record_attempt(address)

    return register_user(
        session=session,
        email=payload.email,
        password=payload.password,
        full_name=payload.full_name,
    )


@router.post("/login", response_model=Token)
def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    session: Session = Depends(get_session),
):
    # The throttle lives here rather than in the service because it needs the
    # request to know who is asking, and it needs the outcome to know whether
    # to charge for it -- a dependency can see the first but not the second.
    address = address_of(request)
    account = form_data.username.strip().lower()

    login_by_address.raise_if_locked(address)
    login_by_account.raise_if_locked(account)

    try:
        token = login_user(
            session=session, email=form_data.username, password=form_data.password
        )
    except HTTPException:
        login_by_address.record_attempt(address)
        login_by_account.record_attempt(account)
        raise

    login_by_address.forgive(address)
    login_by_account.forgive(account)
    return token


@router.get("/me", response_model=UserPublic)
def me(current_user: User = Depends(get_current_user)):
    return current_user

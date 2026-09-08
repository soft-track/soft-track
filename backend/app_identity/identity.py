from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session

from lib_identity.identity import (
    change_password,
    get_current_user,
    list_my_invites,
    login_user,
    register_user,
    sign_out_everywhere,
    update_profile,
)
from lib_identity.models.identity import (
    AuthConfig,
    PasswordChange,
    Token,
    UserCreate,
    UserMe,
    UserUpdate,
)
from lib_softtrack.models.invites import InviteRead
from lib_softtrack.tables import User
from lib_utils.rate_limit import (
    address_of,
    login_by_account,
    login_by_address,
    registration_by_address,
)
from web import get_session, settings

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/config", response_model=AuthConfig)
def auth_config():
    """What the sign-in and sign-up pages need before anyone has a token.

    Public by necessity: the register page has to know whether to show a form
    or an "ask an admin for a link" notice, and it asks before authenticating.
    It reveals only that this instance is invite-only, which its sign-up page
    would say out loud anyway.
    """
    return AuthConfig(open_registration=settings.open_registration)


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
        username=payload.username,
        invite_token=payload.invite_token,
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
    except HTTPException as exc:
        # A deactivated account is not a failed guess: the password was right,
        # so charging for it would let anyone lock out a colleague's address by
        # signing in as them with credentials they legitimately have.
        if exc.status_code != 403:
            login_by_address.record_attempt(address)
            login_by_account.record_attempt(account)
        raise

    login_by_address.forgive(address)
    login_by_account.forgive(account)
    return token


@router.get("/me", response_model=UserMe)
def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserMe)
def update_me(
    payload: UserUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return update_profile(session, current_user, payload)


@router.post("/me/password", response_model=Token)
def change_my_password(
    payload: PasswordChange,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Change the password, and return a token so this tab stays signed in."""
    return change_password(
        session, current_user, payload.current_password, payload.new_password
    )


@router.post("/me/sign-out-everywhere", response_model=Token)
def sign_out_everywhere_route(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return sign_out_everywhere(session, current_user)


@router.get("/me/invites", response_model=list[InviteRead])
def my_invites(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return list_my_invites(session, current_user)

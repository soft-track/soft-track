from typing import Union

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session

from lib_identity.identity import (
    begin_totp_enrolment_db,
    change_password,
    confirm_totp_enrolment,
    disable_totp,
    get_current_user,
    list_my_invites,
    login_user,
    register_user,
    sign_out_everywhere,
    update_profile,
    verify_totp_login,
)
from lib_identity.models.identity import (
    AuthConfig,
    PasswordChange,
    Token,
    TotpDisable,
    TotpEnrolmentConfirm,
    TotpEnrolmentResult,
    TotpEnrolmentStart,
    TotpLoginPending,
    TotpVerifyRequest,
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
    totp_by_address,
    totp_by_user,
)
from lib_utils.token import decode_totp_pending_token
from web import get_session, settings

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/config", response_model=AuthConfig)
def auth_config():
    """What the sign-in and sign-up pages need before anyone has a token.

    Public by necessity: the register page has to know whether to show a form
    or an "ask an admin for a link" notice, and it asks before authenticating.
    It reveals only that this instance is invite-only, whether it has a landing
    page, and whether it is the demo -- all three of which the signed-out pages
    say out loud anyway.
    """
    return AuthConfig(
        open_registration=settings.open_registration,
        landing_page=settings.landing_page,
        demo_credentials=settings.demo_credentials_are_public,
    )


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


@router.post("/login")
@router.post(
    "/login",
    response_model=Union[Token, TotpLoginPending],
    responses={
        200: {"model": Token, "description": "Full access token"},
        202: {"model": TotpLoginPending, "description": "Two-factor code required"},
    },
)
def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    session: Session = Depends(get_session),
):
    """Password step of login.

    Returns a full `Token` (200) for users without TOTP, or a
    `TotpLoginPending` (202) when TOTP is enabled -- the client must then call
    POST /auth/totp/verify to complete the login.
    """
    # The throttle lives here rather than in the service because it needs the
    # request to know who is asking, and it needs the outcome to know whether
    # to charge for it -- a dependency can see the first but not the second.
    address = address_of(request)
    account = form_data.username.strip().lower()

    login_by_address.raise_if_locked(address)
    login_by_account.raise_if_locked(account)

    try:
        result = login_user(
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

    if isinstance(result, TotpLoginPending):
        return JSONResponse(status_code=202, content=result.model_dump())
    return result


@router.post("/totp/verify", response_model=Token)
def totp_verify(
    request: Request,
    payload: TotpVerifyRequest,
    session: Session = Depends(get_session),
):
    address = address_of(request)
    totp_by_address.raise_if_locked(address)

    decoded = decode_totp_pending_token(payload.pending_token)
    if decoded is None:
        totp_by_address.record_attempt(address)
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired two-factor session. Please sign in again.",
        )
    user_id, _ = decoded

    totp_by_user.raise_if_locked(str(user_id))

    try:
        token = verify_totp_login(
            session=session,
            pending_token=payload.pending_token,
            code=payload.code,
        )
    except HTTPException:
        totp_by_address.record_attempt(address)
        totp_by_user.record_attempt(str(user_id))
        raise

    totp_by_address.forgive(address)
    totp_by_user.forgive(str(user_id))
    return token


@router.post("/totp/enrol", response_model=TotpEnrolmentStart)
def totp_enrol(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return begin_totp_enrolment_db(session, current_user)


@router.post("/totp/confirm", response_model=TotpEnrolmentResult)
def totp_confirm(
    payload: TotpEnrolmentConfirm,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    totp_by_user.raise_if_locked(str(current_user.id))
    try:
        result = confirm_totp_enrolment(session, current_user, payload.code)
    except HTTPException:
        totp_by_user.record_attempt(str(current_user.id))
        raise

    totp_by_user.forgive(str(current_user.id))
    return result


@router.post("/totp/disable", response_model=Token)
def totp_disable(
    payload: TotpDisable,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    totp_by_user.raise_if_locked(str(current_user.id))
    try:
        token = disable_totp(session, current_user, payload.code)
    except HTTPException:
        totp_by_user.record_attempt(str(current_user.id))
        raise

    totp_by_user.forgive(str(current_user.id))
    return token


# ---------------------------------------------------------------------------
# Profile and session management
# ---------------------------------------------------------------------------


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

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
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
from lib_identity import api_tokens, password_reset
from lib_identity.api_tokens import RequireSession
from lib_identity.models.api_tokens import ApiTokenCreate, ApiTokenCreated, ApiTokenRead
from lib_identity.models.identity import (
    AuthConfig,
    ForgotPassword,
    PasswordChange,
    ResetPassword,
    Token,
    UserCreate,
    UserMe,
    UserUpdate,
)
from lib_identity.oauth_providers import configured_providers
from lib_softtrack.models.invites import InviteRead
from lib_softtrack.tables import User
from lib_utils.mailer import get_mailer
from lib_utils.rate_limit import (
    address_of,
    login_by_account,
    login_by_address,
    registration_by_address,
    reset_by_account,
    reset_by_address,
)
from web import get_session, settings

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/config", response_model=AuthConfig)
def auth_config():
    """What the sign-in and sign-up pages need before anyone has a token.

    Public by necessity: the register page has to know whether to show a form
    or an "ask an admin for a link" notice, and it asks before authenticating.
    It reveals only that this instance is invite-only, whether it has a landing
    page, whether it is the demo, and which sign-in providers are set up -- all
    four of which the signed-out pages say out loud anyway. Note the last one
    is provider *names*, never their client ids: the id is public in an
    authorization URL, but it does not have to be published to anyone who can
    reach the host.
    """
    return AuthConfig(
        open_registration=settings.open_registration,
        landing_page=settings.landing_page,
        demo_credentials=settings.demo_credentials_are_public,
        oauth_providers=configured_providers(),
        password_reset=settings.email_delivery_configured,
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


@router.post("/forgot-password", status_code=204)
def forgot_password(
    request: Request,
    payload: ForgotPassword,
    background: BackgroundTasks,
    session: Session = Depends(get_session),
):
    """Email a single-use link for choosing a new password.

    Always 204, whether or not the address has an account, so the answer
    cannot be used to find out which addresses do. The mail goes out after
    the response for the same reason: an SMTP round trip is slow enough to
    time.
    """
    address = address_of(request)
    account = payload.email.strip().lower()
    reset_by_address.raise_if_locked(address)
    reset_by_account.raise_if_locked(account)
    reset_by_address.record_attempt(address)
    reset_by_account.record_attempt(account)

    message = password_reset.request_reset(session, payload.email)
    if message is not None:
        background.add_task(get_mailer().send, *message)


@router.post("/reset-password", status_code=204)
def reset_password(payload: ResetPassword, session: Session = Depends(get_session)):
    """Set a new password with the token from a reset link.

    The link works once. Every session the account had is signed out, and
    the next step is signing in with the new password.
    """
    password_reset.reset_password(session, payload.token, payload.new_password)


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
    # A leaked API token must not be able to take the account (#90).
    _session_only: None = RequireSession,
):
    """Change the password, and return a token so this tab stays signed in."""
    return change_password(
        session, current_user, payload.current_password, payload.new_password
    )


@router.get("/me/tokens", response_model=list[ApiTokenRead])
def list_api_tokens(
    current_user: User = Depends(get_current_user),
    _session_only: None = RequireSession,
    session: Session = Depends(get_session),
):
    """Your personal API tokens, without their secrets."""
    return api_tokens.list_tokens(session, current_user)


@router.post("/me/tokens", response_model=ApiTokenCreated)
def create_api_token(
    payload: ApiTokenCreate,
    current_user: User = Depends(get_current_user),
    _session_only: None = RequireSession,
    session: Session = Depends(get_session),
):
    """Make a token for a script: `Authorization: Bearer softtrack_…`.

    The response is the only time the secret is shown. It acts as you, with
    your permissions, until it expires or is revoked. Tokens can only be
    managed from a signed-in session, never with another token.
    """
    return api_tokens.create_token(session, current_user, payload)


@router.delete("/me/tokens/{token_id}", status_code=204)
def revoke_api_token(
    token_id: int,
    current_user: User = Depends(get_current_user),
    _session_only: None = RequireSession,
    session: Session = Depends(get_session),
):
    """Revoke a token. It stops working on the very next request."""
    api_tokens.revoke_token(session, current_user, token_id)


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

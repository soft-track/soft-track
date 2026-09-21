"""Routes for signing in with Google or GitHub, and the accounts so connected.

The two endpoints in the middle of the round trip are the only ones in
SoftTrack a browser *navigates* to rather than fetches, which is why they are
the only ones kept out of the OpenAPI schema. Orval would turn each into a
React Query hook for a 303 -- a hook nothing can call and nobody should, since
an XHR would follow the redirect into the provider's HTML and be refused by
CORS. What the frontend needs is the URL, and that it can build.

Everything either side of them -- minting a link ticket, redeeming the
exchange ticket, applying a finished connect, listing and removing connected
accounts -- is an ordinary JSON endpoint and is generated as usual.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from sqlmodel import Session

from lib_identity import oauth as oauth_service
from lib_identity.identity import get_current_user
from lib_identity.models.identity import Token
from lib_identity.models.oauth import (
    ConnectedIdentity,
    OAuthExchange,
    OAuthLink,
    OAuthLinked,
    OAuthLinkTicket,
)
from lib_identity.oauth_providers import OAuthError
from lib_softtrack.tables import User
from lib_utils.rate_limit import (
    address_of,
    oauth_by_address,
    oauth_callback_by_address,
)
from web import get_session, settings

router = APIRouter(prefix="/auth", tags=["auth"])

#: Where a failed *connect* is reported. A sign-in that goes wrong belongs on
#: the sign-in page; a connect that goes wrong belongs on the page the button
#: was on.
SETTINGS_PATH = "/settings/security"


@router.get("/oauth/{provider}/start", include_in_schema=False)
def start_oauth(
    provider: str,
    request: Request,
    hs: str = Query(default="", max_length=256),
    next_path: str | None = Query(default=None, alias="next"),
    invite: str | None = Query(default=None),
    ticket: str | None = Query(default=None),
):
    """Send the browser to the provider, remembering what it will need back.

    `hs` is the handshake the frontend generated and kept; only its digest is
    stored here. `ticket` turns this into a connect rather than a sign-in --
    see `lib_identity/oauth.py`.
    """
    # A browser navigated here, so every exit has to be a page -- including
    # the refusals. FastAPI would answer an HTTPException with a JSON body,
    # which the address bar would render as text with no way back.
    to_settings = bool(ticket)
    address = address_of(request)
    try:
        oauth_by_address.raise_if_locked(address)
    except HTTPException:
        return _leave("throttled", to_settings=to_settings)
    # Charged before the attempt and never forgiven: an abandoned consent
    # screen is indistinguishable from a completed one from here, so only
    # counting failures would count nothing.
    oauth_by_address.record_attempt(address)

    try:
        resolved = oauth_service.provider_or_404(provider)
    except HTTPException:
        return _leave("unavailable", to_settings=to_settings)

    try:
        url, state = oauth_service.begin(
            resolved,
            handshake=hs,
            next_path=next_path,
            invite_token=invite,
            link_ticket=ticket,
        )
    except OAuthError as exc:
        return _leave(exc.code, to_settings=to_settings)

    response = RedirectResponse(url, status_code=303)
    response.set_cookie(
        oauth_service.STATE_COOKIE_NAME,
        state,
        # Deliberately longer than the JWT inside it. The `exp` is what is
        # enforced; the cookie merely has to survive long enough afterwards to
        # say which page this round trip started from, so a connect that
        # expires at the consent screen is reported on Settings rather than on
        # a sign-in page the person is already past.
        max_age=settings.oauth_state_expire_minutes * 60 + 300,
        # Not readable from script, and not sent with anything but a top-level
        # navigation -- which is exactly what the provider's redirect back is.
        httponly=True,
        samesite="lax",
        secure=oauth_service.state_cookie_is_secure(),
        path=oauth_service.STATE_COOKIE_PATH,
    )
    return response


@router.get("/oauth/{provider}/callback", include_in_schema=False)
def oauth_callback(
    provider: str,
    request: Request,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    session: Session = Depends(get_session),
):
    """Finish the round trip and send the browser back to the app.

    Every exit from here is a redirect. There is nobody to read a JSON body:
    the thing making this request is a browser that followed the provider's
    redirect, and the only useful answer is a page.
    """
    state_cookie = request.cookies.get(oauth_service.STATE_COOKIE_NAME)
    # Read before anything can fail, so a refusal is reported on whichever page
    # the person is actually looking at.
    to_settings = oauth_service.is_link_flow(state_cookie)

    address = address_of(request)
    try:
        oauth_callback_by_address.raise_if_locked(address)
    except HTTPException:
        return _leave("throttled", to_settings=to_settings)
    # Charged unconditionally: what this bounds is the outbound call below,
    # which a replayed callback makes whether or not the code turns out to be
    # good. A completed sign-in forgives it at the bottom.
    oauth_callback_by_address.record_attempt(address)

    try:
        resolved = oauth_service.provider_or_404(provider)
    except HTTPException:
        return _leave("unavailable", to_settings=to_settings)

    if error or not code:
        # "Cancel" on the consent screen, or the provider refusing. `error` is
        # not passed on -- it is attacker-controllable text arriving in a query
        # string, and it would be rendered by the page it lands on.
        return _leave("cancelled", to_settings=to_settings)

    try:
        finished = oauth_service.complete(
            session, resolved, code=code, state=state, state_cookie=state_cookie
        )
    except OAuthError as exc:
        return _leave(exc.code, to_settings=to_settings)
    except HTTPException:
        # A backstop. No path below currently raises one -- `derive_username`
        # loops until it finds a free handle rather than refusing, and
        # `_accept_invitation` swallows its own -- but the browser needs a page
        # rather than a 400 body it would render as text, so an unexpected
        # service-layer refusal must not become one.
        return _leave("failed", to_settings=to_settings)

    oauth_callback_by_address.forgive(address)

    # Either way a ticket, never a session and never a finished write. Both
    # kinds are inert on their own: the sign-in one needs the handshake that
    # never left the tab this started in, and the connect one needs a live
    # session for the account it names.
    fragment = (
        {"link": finished.link_result}
        if finished.link_result
        else {"ticket": finished.ticket}
    )
    return _cleared(
        RedirectResponse(
            oauth_service.frontend_url(
                "/oauth/callback", fragment={**fragment, "next": finished.next_path}
            ),
            status_code=303,
        )
    )


@router.post("/oauth/exchange", response_model=Token)
def exchange_ticket(
    payload: OAuthExchange,
    session: Session = Depends(get_session),
):
    """Redeem a finished sign-in for a session.

    Deliberately unauthenticated and deliberately a POST: the ticket and the
    handshake together are the credential, and neither belongs in a URL.
    """
    return oauth_service.exchange(session, payload.ticket, payload.handshake)


@router.post("/oauth/{provider}/link-ticket", response_model=OAuthLinkTicket)
def mint_link_ticket(
    provider: str,
    current_user: User = Depends(get_current_user),
):
    """Permission to *begin* attaching `provider` to the account asking.

    Connecting is not a sign-in and must never behave like one: without this,
    "Connect" would run the ordinary flow and could sign somebody into a
    *different* account, or create a third, with nothing on screen to say so.

    This half only opens the round trip. The write needs `/auth/oauth/link`
    below, which needs a session -- so this ticket travelling in a URL cannot
    on its own attach anything to anybody.
    """
    resolved = oauth_service.provider_or_404(provider)
    return OAuthLinkTicket(ticket=oauth_service.link_ticket(current_user, resolved))


@router.post("/oauth/link", response_model=OAuthLinked)
def apply_link(
    payload: OAuthLink,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Attach the provider account a finished connect round trip identified."""
    return OAuthLinked(
        provider=oauth_service.apply_link(session, current_user, payload.ticket)
    )


@router.get("/me/identities", response_model=list[ConnectedIdentity])
def my_identities(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return oauth_service.connected_identities(session, current_user)


@router.delete("/me/identities/{provider}", status_code=204)
def disconnect_identity(
    provider: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    oauth_service.disconnect(session, current_user, provider)
    return Response(status_code=204)


def _leave(code: str, *, to_settings: bool = False) -> RedirectResponse:
    """Back to the page this started from, with a code it knows how to word."""
    return _cleared(
        RedirectResponse(
            oauth_service.frontend_url(
                SETTINGS_PATH if to_settings else "/login", query={"error": code}
            ),
            status_code=303,
        )
    )


def _cleared(response: RedirectResponse) -> RedirectResponse:
    """Drop the state cookie. It is spent either way, success or not."""
    response.delete_cookie(
        oauth_service.STATE_COOKIE_NAME,
        path=oauth_service.STATE_COOKIE_PATH,
        samesite="lax",
        secure=oauth_service.state_cookie_is_secure(),
        httponly=True,
    )
    return response

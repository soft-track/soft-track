"""Signing in with Google or GitHub: the round trip, and who comes back from it.

Four decisions shape everything here, and each of them is a trade worth
knowing about.

**The half-finished sign-in is carried in a signed cookie, not in a table.**
Between the redirect out and the callback back there is state to keep -- which
provider, the anti-forgery nonce, the PKCE verifier, where the person was
going. A row would need a table, an expiry sweep and a write on every button
press. A short-lived JWT in an `HttpOnly` cookie needs none of those and works
the same across several workers, which the in-process throttle in
`lib_utils/rate_limit.py` deliberately does not.

**No session token ever appears in a URL.** The callback cannot return JSON --
it is a browser navigation -- so what it redirects with is a two-minute
*exchange ticket*, which is worth nothing on its own. Redeeming it needs the
random handshake the frontend generated before it left and kept in
`sessionStorage`, and the answer comes back in a JSON body. Without that, a
link of the form `/oauth/callback#token=...` mailed to somebody would silently
sign them into the sender's account -- login CSRF -- and they would file their
bugs and upload their screenshots into a workspace somebody else owns.

**An address joins a provider to an existing account only when *both* sides of
it are trustworthy.** The provider's side is its `email_verified`. SoftTrack's
side is the harder one: nothing here has ever confirmed that the person who
typed an address at `/auth/register` can read mail sent to it, and nothing
confirms it when a password-less account renames itself either. So the
automatic link needs a claim a *provider* wrote -- an existing `UserIdentity`
row already holding the same address -- and not merely the absence of a
password. Anything weaker is the account pre-hijacking hole: take the address
first, wait for its owner to press "Continue with Google", and keep your own
way back in. An account this cannot vouch for is refused, and its owner is
asked to sign in the way it was made and connect the provider from Settings,
where the session is the proof. See `_assert_a_provider_vouches_for`.

**A returning sign-in is matched on the provider's `subject`, never on the
address.** The address is consulted exactly once, on the first sign-in. After
that, changing it on either side keeps the account -- and inheriting a departed
colleague's mailbox does not inherit their account with it.
"""

import hashlib
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlencode

from fastapi import HTTPException
from jose import JWTError, jwt
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from lib_identity import oauth_providers
from lib_identity.identity import create_user, find_user_by_email, issue_token
from lib_identity.models.identity import Token
from lib_identity.models.oauth import ConnectedIdentity
from lib_identity.oauth_providers import OAuthError, OAuthIdentity, Provider
from lib_softtrack.tables import OAuthProvider, User, UserIdentity, utcnow
from lib_utils.password import is_usable_password, unusable_password
from web import settings
from lib_utils.errors import ErrorCode, api_error

#: Holds the signed state for one sign-in attempt. Scoped to /auth, which is
#: the only prefix either endpoint lives under, so it is not attached to every
#: API request for the ten minutes it exists.
STATE_COOKIE_NAME = "softtrack_oauth"
STATE_COOKIE_PATH = "/auth"

#: Distinguishes the three things signed with the instance's one key. An
#: access token carries no `typ` at all, and nothing here accepts one without.
_STATE_TYPE = "oauth_state"
_EXCHANGE_TYPE = "oauth_exchange"
_LINK_TYPE = "oauth_link"
_LINK_RESULT_TYPE = "oauth_link_result"

#: The window between the callback redirecting and the frontend redeeming. Two
#: page loads, not a coffee break.
_EXCHANGE_TTL_MINUTES = 2
#: Between pressing Connect and arriving back from the provider. Long enough to
#: read a consent screen, short enough that a ticket left in a URL bar goes
#: stale before anyone finds it.
_LINK_TTL_MINUTES = 5
#: Between arriving back and the settings page posting the result. Two page
#: loads, like the exchange ticket.
_LINK_RESULT_TTL_MINUTES = 2

#: Control characters and spaces, which have no business in a path that is
#: about to be concatenated into a `Location` header.
_UNSAFE_IN_PATH = re.compile(r"[\x00-\x20\x7f]")

#: A `next` longer than this is not a page on this instance, it is somebody
#: probing.
_MAX_NEXT_LENGTH = 512


@dataclass
class Completed:
    """What the callback should do with a finished round trip."""

    next_path: str
    #: Sign-in: redeem this at `/auth/oauth/exchange` for a session.
    ticket: str | None = None
    #: Connect: post this to `/auth/oauth/link` to attach the provider account
    #: it names. Nothing has been written yet -- see `apply_link`.
    link_result: str | None = None


# ---------------------------------------------------------------------------
# The round trip
# ---------------------------------------------------------------------------


def provider_or_404(name: str) -> Provider:
    """The named provider, if this instance has been given its credentials.

    Unknown and un-configured answer the same 404 on purpose. Which providers
    an operator has set up is already public on `/auth/config` -- what is not
    worth publishing is a different response for "google exists but you have
    not configured it", which is a question about the deployment.
    """
    provider = oauth_providers.PROVIDERS.get(name)
    if provider is None or not oauth_providers.is_configured(name):
        raise api_error(
            status_code=404,
            code=ErrorCode.oauth_provider_disabled,
            detail="That sign-in provider is not enabled here",
        )
    return provider


def callback_url(provider: Provider) -> str:
    """Where the provider sends the browser back.

    Built from `api_base_url` because the provider talks to the API, not to
    the frontend -- and it has to match what was registered with the provider
    character for character, which is the setting people get wrong first.
    """
    return f"{settings.api_base_url.rstrip('/')}/auth/oauth/{provider.name}/callback"


def begin(
    provider: Provider,
    *,
    handshake: str,
    next_path: str | None = None,
    invite_token: str | None = None,
    link_ticket: str | None = None,
) -> tuple[str, str]:
    """Start a round trip: where to send the browser, and the state to remember.

    Returns `(authorization_url, state_cookie_value)`. The caller sets the
    cookie, because only the route knows what a response is.

    `handshake` is a random string the frontend generated and kept; only its
    digest is stored, and producing the original again is what redeems the
    ticket at the end. `link_ticket` turns this into a *connect* rather than a
    sign-in: the person is already signed in and is attaching a provider to
    the account they are holding.
    """
    if not handshake:
        # There is no legitimate caller without one, and a path that carries on
        # regardless is this feature's CSRF hole reopening quietly.
        raise OAuthError("state")

    linking = _decode(link_ticket, _LINK_TYPE) if link_ticket else None
    if link_ticket and (linking is None or linking.get("provider") != provider.name):
        raise OAuthError("link_expired")

    nonce = secrets.token_urlsafe(32)
    verifier = oauth_providers.new_verifier()
    state_cookie = _encode(
        {
            "provider": provider.name,
            # Sent to the provider as `state` and compared on the way back.
            # The copy the provider sees is public; the copy in the cookie is
            # not, and an attacker who cannot produce both cannot hand
            # somebody else's authorization code to this browser.
            "nonce": nonce,
            # Never leaves the cookie. See RFC 7636: the challenge goes out,
            # the verifier comes back from here, and a stolen code is useless
            # without it. This is also why the state parameter is a bare nonce
            # rather than the signed blob itself -- signed is not encrypted,
            # and the provider logs whatever it is handed.
            "verifier": verifier,
            "hs": _digest(handshake),
            "next": same_site_path(next_path),
            "invite": (invite_token or "")[:256] or None,
            "link_user_id": linking.get("uid") if linking else None,
            "link_ver": linking.get("ver") if linking else None,
        },
        _STATE_TYPE,
        settings.oauth_state_expire_minutes,
    )
    url = oauth_providers.authorization_url(
        provider, callback_url(provider), nonce, verifier
    )
    return url, state_cookie


def is_link_flow(state_cookie: str | None) -> bool:
    """Whether this round trip was started from Settings rather than from /login.

    Read before `complete` so that a failure can be reported on the page the
    person is actually looking at -- which includes the most likely failure of
    all, the cookie having expired while the consent screen was open. So the
    expiry is ignored here and nowhere else: this decides a destination, not
    an outcome, and `complete` still refuses the same request a moment later.
    """
    claims = _decode(state_cookie, _STATE_TYPE, expired_is_fine=True)
    return bool(claims and claims.get("link_user_id"))


def complete(
    session: Session,
    provider: Provider,
    *,
    code: str,
    state: str | None,
    state_cookie: str | None,
) -> Completed:
    """Finish a round trip, either as a sign-in or as a connect."""
    claims = _decode(state_cookie, _STATE_TYPE)
    if claims is None or claims.get("provider") != provider.name:
        # No cookie, a tampered one, one that expired while the consent screen
        # was open -- or a callback for a provider other than the one this
        # browser started with.
        raise OAuthError("state")

    nonce = str(claims.get("nonce") or "")
    if not state or not nonce or not secrets.compare_digest(nonce, state):
        raise OAuthError("state")

    access_token = oauth_providers.exchange_code(
        provider, code, callback_url(provider), str(claims.get("verifier") or "")
    )
    identity = oauth_providers.fetch_identity(provider, access_token)
    next_path = same_site_path(claims.get("next"))

    if claims.get("link_user_id"):
        # Nothing is written here. The account this would attach to is named
        # only by a ticket that arrived in a query string -- the browser's
        # history and this API's access log both have a copy -- so the write
        # waits for `/auth/oauth/link`, which needs a live session for the
        # same account. Whoever lifted the ticket can complete this round trip
        # and gets a result they cannot spend.
        user = _linking_user(session, claims)
        return Completed(
            next_path=next_path,
            link_result=_encode(
                {
                    "uid": user.id,
                    "ver": user.token_version,
                    "provider": provider.name,
                    "subject": identity.subject,
                    "email": (identity.email or "").strip().lower() or None,
                },
                _LINK_RESULT_TYPE,
                _LINK_RESULT_TTL_MINUTES,
            ),
        )

    user = resolve_user(session, provider, identity)

    invite = claims.get("invite") or None
    if invite and not _accept_invitation(session, user, invite):
        # Signed in, but the invitation was not theirs to accept -- almost
        # always because the address the provider reports is not the one it was
        # sent to. The invitation page says exactly that and offers the way
        # out; the requested destination would be a board they are not on.
        next_path = same_site_path(f"/invite/{quote(invite, safe='')}")

    user.last_login_at = utcnow()
    session.add(user)
    session.commit()
    session.refresh(user)

    ticket = _encode(
        {"uid": user.id, "ver": user.token_version, "hs": claims.get("hs")},
        _EXCHANGE_TYPE,
        _EXCHANGE_TTL_MINUTES,
    )
    return Completed(next_path=next_path, ticket=ticket)


def resolve_user(session: Session, provider: Provider, identity: OAuthIdentity) -> User:
    """Which account this provider identity signs in as.

    Three outcomes, in this order and no other:

    1. The provider account is already connected -- that user, whatever either
       side now calls their address.
    2. It is not, the provider has *verified* an address, and an account here
       uses that address, has no password of its own, and already has a
       *different* provider vouching for the same address. Connect the two --
       both halves of the address have then been confirmed by somebody other
       than whoever typed it. See `_assert_a_provider_vouches_for`.
    3. Nothing matches -- create an account, under the same gate
       `/auth/register` applies.

    An existing account that *does* have a password is refused rather than
    joined, and its owner is told to sign in and connect it from Settings.
    """
    stored_provider = OAuthProvider(provider.name)
    existing = session.exec(
        select(UserIdentity).where(
            UserIdentity.provider == stored_provider,
            UserIdentity.subject == identity.subject,
        )
    ).first()

    if existing is not None:
        user = session.get(User, existing.user_id)
        if user is None:
            raise OAuthError("failed")
        if not user.is_active:
            raise OAuthError("deactivated")
        existing.last_login_at = utcnow()
        if identity.email:
            existing.email = identity.email.strip().lower()
        session.add(existing)
        session.commit()
        return user

    email = (identity.email or "").strip().lower()
    if not email:
        raise OAuthError("no_email")
    if not identity.email_verified:
        raise OAuthError("email_unverified")

    user = find_user_by_email(session, email)
    if user is None:
        user = _register(session, email, identity)
    else:
        if not user.is_active:
            raise OAuthError("deactivated")
        if is_usable_password(user.hashed_password):
            raise OAuthError("account_exists")
        _assert_a_provider_vouches_for(session, user, stored_provider, email)

    connect(session, user, provider, identity)
    return user


def _assert_a_provider_vouches_for(
    session: Session, user: User, provider: OAuthProvider, email: str
) -> None:
    """Refuse unless some provider has already confirmed this address here.

    "Has no password" is not on its own evidence of anything. It is evidence at
    the moment the account is created -- only `_register` writes an unusable
    hash -- but `update_profile` then lets exactly those accounts rename
    themselves to any free address with nothing to confirm against, because
    there is no password to ask for and SoftTrack sends no verification mail.

    Without this, the pre-hijacking hole reopens one step along: sign in with
    GitHub as yourself, rename the account to `victim@company.example`, and
    wait for them to press "Continue with Google" for the first time. They land
    in your account, and your GitHub still opens it.

    So the claim has to be one a *provider* wrote. `UserIdentity.email` is only
    ever set from what a provider reported (`connect`, and the refresh in
    `resolve_user`), and never from `User.email`.
    """
    rows = session.exec(
        select(UserIdentity).where(UserIdentity.user_id == user.id)
    ).all()

    if not any((row.email or "") == email for row in rows):
        raise OAuthError("connect_required")

    if any(row.provider == provider for row in rows):
        # The address checks out, but this account already signs in with a
        # different account at *this* provider. That is a reassigned address --
        # a Workspace seat given to somebody new -- not the same person.
        raise OAuthError("connect_required")


def _register(session: Session, email: str, identity: OAuthIdentity) -> User:
    """Create the account a first sign-in implies, under the usual gate.

    The same rule as `/auth/register`: on a closed instance the invitation is
    what lets an account exist at all, and it is checked against the address
    the provider reported rather than against a link, so arriving through
    Google does not get round it.
    """
    from lib_softtrack.invites import find_live_invite

    if not settings.open_registration and not find_live_invite(session, email):
        raise OAuthError("closed")

    return create_user(
        session,
        email=email,
        full_name=(identity.full_name or "").strip() or email.split("@")[0],
        # No password, rather than a random one nobody can ever produce: the
        # account says so on the Security page and can be given one there.
        hashed_password=unusable_password(),
    )


def _accept_invitation(session: Session, user: User, token: str) -> bool:
    """Spend the invitation this sign-in arrived with, if it is theirs.

    Best effort, as registration does it: a stale or misaddressed link must not
    undo an account that already exists. Unlike registration, the answer is
    reported back -- somebody whose provider address differs from the invited
    one needs to be told, not dropped on a board they are not a member of.

    "Already spent" counts as success, so signing in twice with the same link
    does not send a member back to a dead invitation page.
    """
    from lib_softtrack.invites import accept_invite

    try:
        accept_invite(session, user, token)
        return True
    except HTTPException as exc:
        return exc.status_code == 404


# ---------------------------------------------------------------------------
# Connecting, listing and disconnecting
# ---------------------------------------------------------------------------


def link_ticket(user: User, provider: Provider) -> str:
    """A short-lived token saying "this signed-in person wants that provider".

    The start endpoint is a navigation, so it cannot carry an `Authorization`
    header, and a cookie set on an XHR response would not survive the default
    split-origin deployment. So the authenticated call mints this and the
    browser carries it once, on the way out. It authenticates nobody: the only
    thing it can do is attach a provider to the account it names, and it is
    void the moment that account's token version moves.
    """
    return _encode(
        {
            # `uid`, not `sub`: a claim `get_current_user` does not read, so
            # this cannot be mistaken for a session even before the `typ`
            # check gets to it.
            "uid": user.id,
            "ver": user.token_version,
            "provider": provider.name,
        },
        _LINK_TYPE,
        _LINK_TTL_MINUTES,
    )


def apply_link(session: Session, user: User, ticket: str) -> str:
    """Attach the provider account a finished connect round trip identified.

    Authenticated, and the second half of the pair `link_ticket` starts. The
    ticket says which account it is for; the bearer token says which account is
    asking; they have to agree. That is what makes a stolen link ticket
    worthless -- it can complete a round trip, but the result can only be
    spent by somebody already holding the session it names.
    """
    expired = api_error(
        status_code=400,
        code=ErrorCode.oauth_expired,
        detail="That connection request has expired",
    )
    claims = _decode(ticket, _LINK_RESULT_TYPE)
    if claims is None:
        raise expired
    if int(claims.get("uid") or 0) != user.id:
        raise expired
    if claims.get("ver") != user.token_version:
        raise expired

    provider = provider_or_404(str(claims.get("provider") or ""))
    try:
        connect(
            session,
            user,
            provider,
            OAuthIdentity(
                subject=str(claims["subject"]),
                email=claims.get("email"),
                # Vouched for by the round trip that produced this ticket, not
                # re-read from anywhere: nothing here talks to the provider.
                email_verified=True,
                full_name=None,
            ),
        )
    except OAuthError as exc:
        raise api_error(
            status_code=409,
            code=(
                ErrorCode.oauth_account_taken
                if exc.code == "already_connected"
                else ErrorCode.oauth_connect_failed
            ),
            detail=(
                "That account already signs in to a different SoftTrack account"
                if exc.code == "already_connected"
                else "Could not connect that account"
            ),
        )
    return provider.name


def connect(
    session: Session,
    user: User,
    provider: Provider,
    identity: OAuthIdentity,
) -> None:
    """Attach a provider account to a user, replacing any it already had.

    One row per (user, provider), so connecting a second Google re-points the
    first rather than leaving two keys to one door -- which is what would make
    `DELETE /auth/me/identities/google` ambiguous about which it removed, and
    what would make "would this leave you locked out?" miscount.

    Replacing is only ever reached deliberately, from Connect in Settings: the
    automatic path refuses before it gets here if the account already has an
    identity for this provider, because there the address is the only evidence
    and a reassigned address is not the same person.
    """
    stored = OAuthProvider(provider.name)
    email = (identity.email or "").strip().lower() or None

    held_by_someone = session.exec(
        select(UserIdentity).where(
            UserIdentity.provider == stored,
            UserIdentity.subject == identity.subject,
        )
    ).first()
    if held_by_someone is not None and held_by_someone.user_id != user.id:
        raise OAuthError("already_connected")

    row = held_by_someone or _identity_for(session, user, stored)
    if row is None:
        row = UserIdentity(user_id=user.id, provider=stored, subject=identity.subject)
    else:
        row.subject = identity.subject

    row.email = email
    row.last_login_at = utcnow()
    session.add(row)
    try:
        session.commit()
    except IntegrityError:
        # Two tabs finishing the same first sign-in at once. The unique
        # constraints are what stop the second one writing a duplicate; the
        # person only has to press the button again.
        session.rollback()
        raise OAuthError("failed")


def connected_identities(session: Session, user: User) -> list[ConnectedIdentity]:
    rows = session.exec(
        select(UserIdentity)
        .where(UserIdentity.user_id == user.id)
        .order_by(col(UserIdentity.created_at), col(UserIdentity.id))
    ).all()
    return [
        ConnectedIdentity(
            provider=row.provider,
            email=row.email,
            connected_at=row.created_at,
            last_login_at=row.last_login_at,
        )
        for row in rows
    ]


def disconnect(session: Session, user: User, name: str) -> None:
    """Remove a provider's key to this account.

    Refused when it is the last one and there is no password, because the next
    screen after that would be a sign-in form the person cannot satisfy, and
    recovering needs a site administrator.
    """
    try:
        provider = OAuthProvider(name)
    except ValueError:
        raise api_error(
            status_code=404,
            code=ErrorCode.oauth_provider_unknown,
            detail="Unknown sign-in provider",
        )

    rows = session.exec(
        select(UserIdentity).where(UserIdentity.user_id == user.id)
    ).all()
    row = next((r for r in rows if r.provider == provider), None)
    if row is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.oauth_not_connected,
            detail="That account is not connected",
        )

    if len(rows) == 1 and not is_usable_password(user.hashed_password):
        raise api_error(
            status_code=400,
            code=ErrorCode.password_required_to_disconnect,
            detail=(
                "Set a password first — disconnecting this would leave you no "
                "way to sign in."
            ),
        )

    session.delete(row)
    session.commit()


def _identity_for(
    session: Session, user: User, provider: OAuthProvider
) -> UserIdentity | None:
    return session.exec(
        select(UserIdentity).where(
            UserIdentity.user_id == user.id, UserIdentity.provider == provider
        )
    ).first()


def _linking_user(session: Session, claims: dict) -> User:
    user = session.get(User, int(claims["link_user_id"]))
    if user is None or not user.is_active:
        raise OAuthError("link_expired")
    # The session that asked for this may have been signed out in the meantime
    # -- a password change, a "sign out everywhere", a deactivation and back.
    # Whatever ended it ends this too.
    if user.token_version != claims.get("link_ver"):
        raise OAuthError("link_expired")
    return user


# ---------------------------------------------------------------------------
# Redeeming the ticket
# ---------------------------------------------------------------------------


def exchange(session: Session, ticket: str, handshake: str) -> Token:
    """Trade the callback's ticket for a session.

    The ticket travelled in a URL fragment and the handshake never left the
    tab that started the sign-in, so holding both is what says this browser is
    the one that asked. A ticket on its own -- forwarded, screenshotted, found
    in somebody's history -- is inert.
    """
    claims = _decode(ticket, _EXCHANGE_TYPE)
    if claims is None or not handshake:
        raise api_error(
            status_code=400,
            code=ErrorCode.oauth_expired,
            detail="That sign-in has expired",
        )

    expected = str(claims.get("hs") or "")
    if not expected or not secrets.compare_digest(expected, _digest(handshake)):
        raise api_error(
            status_code=400,
            code=ErrorCode.oauth_expired,
            detail="That sign-in has expired",
        )

    user = session.get(User, int(claims["uid"]))
    if user is None or not user.is_active:
        raise api_error(
            status_code=400,
            code=ErrorCode.oauth_expired,
            detail="That sign-in has expired",
        )
    if user.token_version != claims.get("ver"):
        raise api_error(
            status_code=400,
            code=ErrorCode.oauth_expired,
            detail="That sign-in has expired",
        )

    return issue_token(user)


# ---------------------------------------------------------------------------
# URLs, digests and signed blobs
# ---------------------------------------------------------------------------


def same_site_path(value) -> str:
    """A path on this instance's frontend, or `/`.

    The same rule as `signInDestination` in the frontend, enforced here as
    well because this is the copy that ends up in a `Location` header. `next`
    began life in somebody's address bar, and `https://elsewhere.example` --
    or the protocol-relative `//elsewhere.example`, which browsers also read
    out of the backslash form `/\\elsewhere.example` -- appended to
    `app_base_url` would turn signing in into an open redirect.
    """
    if not isinstance(value, str) or not value:
        return "/"
    if len(value) > _MAX_NEXT_LENGTH or _UNSAFE_IN_PATH.search(value):
        return "/"
    if not value.startswith("/") or value.startswith("//") or value.startswith("/\\"):
        return "/"
    return value


def frontend_url(
    path: str, *, query: dict | None = None, fragment: dict | None = None
) -> str:
    """A URL on the browser app, built from `app_base_url`."""
    url = f"{settings.app_base_url.rstrip('/')}{path}"
    if query:
        url = f"{url}?{urlencode(query)}"
    if fragment:
        url = f"{url}#{urlencode(fragment)}"
    return url


def state_cookie_is_secure() -> bool:
    """`Secure` whenever the API is reachable over TLS.

    Read from `api_base_url` rather than from the request, because behind a
    proxy that terminates TLS the request itself arrives over plain HTTP and
    would say no.
    """
    return settings.api_base_url.lower().startswith("https://")


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _encode(claims: dict, kind: str, expire_minutes: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=expire_minutes)
    return jwt.encode(
        {**claims, "typ": kind, "exp": expire},
        settings.secret_key,
        algorithm=settings.algorithm,
    )


def _decode(
    token: str | None, kind: str, *, expired_is_fine: bool = False
) -> dict | None:
    """Claims of a blob this instance signed for exactly this purpose.

    The `typ` check is what keeps three differently-privileged tokens apart
    when they share one signing key: a state cookie must not be redeemable as
    a session, and a link ticket must not be usable as either. An access token
    carries `typ: "access"` (or, if it predates that, nothing at all), so it
    fails all three -- and the tickets name their subject in `uid`, which
    `get_current_user` does not read, so the reverse does not work either.
    """
    if not token:
        return None
    try:
        claims = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.algorithm],
            options={"verify_exp": not expired_is_fine},
        )
    except JWTError:
        return None
    if claims.get("typ") != kind:
        return None
    return claims

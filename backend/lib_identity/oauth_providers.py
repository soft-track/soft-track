"""What Google and GitHub are, and what each will tell us about a person.

Two providers, and deliberately no plugin point. The differences between them
are not configuration -- Google hands back an address with the profile and says
whether it was verified, GitHub hands back neither and has to be asked for the
address separately -- so a generic "OIDC provider" setting would be a lie about
both of them. Enterprise SAML/OIDC is a separate piece of work; see
docs/roadmap.md.

Nothing here touches the database or the session. This module knows how to ask
a provider who somebody is; turning that answer into a signed-in SoftTrack user
is `lib_identity/oauth.py`.
"""

import base64
import hashlib
import secrets
from dataclasses import dataclass, field
from typing import Callable
from urllib.parse import urlencode

import httpx

from web import settings

#: Long enough that a slow provider is not mistaken for a broken one, short
#: enough that a hanging call does not hold a worker thread for a minute. Both
#: legs of the exchange happen while a person is staring at a blank tab.
HTTP_TIMEOUT_SECONDS = 10.0


class OAuthError(Exception):
    """A sign-in that cannot be completed, with a code the browser is told.

    A code rather than a sentence because the failure surfaces after a
    redirect: the callback has nowhere to put a JSON body, so it sends the
    browser back to /login with `?error=<code>` and the frontend says the rest.
    The wording lives there, next to every other string a person reads.
    """

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class OAuthIdentity:
    """Who the provider says this is.

    `subject` is the provider's own immutable id for the account, and is the
    only field safe to key on: an address can be changed, a display name means
    nothing, and both belong to the person rather than to the account.
    """

    subject: str
    email: str | None
    #: Whether the *provider* has confirmed the address belongs to this person.
    #: An unverified address is never allowed to reach an existing SoftTrack
    #: account -- see `lib_identity/oauth.py`.
    email_verified: bool
    full_name: str | None


@dataclass(frozen=True)
class Provider:
    name: str
    authorize_url: str
    token_url: str
    scope: str
    _identity: Callable[[httpx.Client, str], OAuthIdentity]
    #: Extra parameters on the authorization request, beyond the ones every
    #: provider takes.
    authorize_params: dict[str, str] = field(default_factory=dict)
    #: RFC 7636. Google implements it; GitHub's OAuth apps do not, and sending
    #: a challenge it ignores would read as protection that is not there.
    supports_pkce: bool = False


# ---------------------------------------------------------------------------
# Google
# ---------------------------------------------------------------------------

GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"


def _google_identity(client: httpx.Client, access_token: str) -> OAuthIdentity:
    """Google's OIDC userinfo endpoint.

    Deliberately the userinfo endpoint rather than the `id_token` that arrives
    alongside the access token. Reading the id_token means verifying its
    signature, which means fetching and caching Google's JWKS and tracking key
    rotation -- real machinery for no gain here, because this request goes
    straight to Google over TLS and the answer is authenticated by the
    connection rather than by a signature we would have to check ourselves.
    """
    body = _json(
        client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
    )
    if not isinstance(body, dict):
        raise OAuthError("profile_failed")
    subject = body.get("sub")
    if not subject:
        raise OAuthError("profile_failed")

    # `email_verified` is what the current endpoint returns; `verified_email`
    # is what the older one did. Read both, default to unverified -- the
    # consequence of getting this wrong is letting somebody else's address
    # into an existing account, so absence has to mean no.
    verified = body.get("email_verified", body.get("verified_email", False))

    return OAuthIdentity(
        subject=str(subject),
        email=body.get("email"),
        email_verified=verified is True or verified == "true",
        full_name=body.get("name"),
    )


# ---------------------------------------------------------------------------
# GitHub
# ---------------------------------------------------------------------------

GITHUB_USER_URL = "https://api.github.com/user"
GITHUB_EMAILS_URL = "https://api.github.com/user/emails"

_GITHUB_HEADERS = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}


def _github_identity(client: httpx.Client, access_token: str) -> OAuthIdentity:
    """GitHub's profile, plus the separate call that gets a usable address.

    `/user` carries an `email` only when the account has set a *public* one,
    and a public address is not a verified one. The address that can be
    trusted lives behind `/user/emails`, which is what `user:email` is scoped
    for -- so both calls, every time.
    """
    headers = {**_GITHUB_HEADERS, "Authorization": f"Bearer {access_token}"}
    profile = _json(client.get(GITHUB_USER_URL, headers=headers))

    if not isinstance(profile, dict):
        raise OAuthError("profile_failed")
    subject = profile.get("id")
    if not subject:
        raise OAuthError("profile_failed")

    email, verified = _github_primary_email(client, headers)
    if email is None:
        # No verified address behind the scope, so fall back to whatever the
        # profile made public -- and keep it marked unverified, which means it
        # can create an account but never join itself to an existing one.
        email = profile.get("email")
        verified = False

    return OAuthIdentity(
        subject=str(subject),
        email=email,
        email_verified=verified,
        full_name=profile.get("name") or profile.get("login"),
    )


def _github_primary_email(
    client: httpx.Client, headers: dict[str, str]
) -> tuple[str | None, bool]:
    """The account's primary verified address, if `user:email` was granted.

    A missing scope answers 403 rather than failing the sign-in: an account
    with no address SoftTrack may read is a usable state -- it just cannot be
    linked to an existing one by address.
    """
    response = client.get(GITHUB_EMAILS_URL, headers=headers)
    if response.status_code == 403 or response.status_code == 404:
        return None, False

    rows = _json(response)
    if not isinstance(rows, list):
        return None, False

    verified = [
        row
        for row in rows
        if isinstance(row, dict) and row.get("verified") and row.get("email")
    ]
    # Primary first; otherwise any verified address, because an account whose
    # primary is unverified still has one address GitHub has confirmed.
    for row in verified:
        if row.get("primary"):
            return row["email"], True
    if verified:
        return verified[0]["email"], True
    return None, False


PROVIDERS: dict[str, Provider] = {
    "google": Provider(
        name="google",
        authorize_url="https://accounts.google.com/o/oauth2/v2/auth",
        token_url="https://oauth2.googleapis.com/token",
        scope="openid email profile",
        _identity=_google_identity,
        # Without this Google signs straight back in as whoever the browser
        # used last, which on a shared machine is the wrong person and looks
        # like SoftTrack's bug rather than the browser's state.
        authorize_params={"prompt": "select_account"},
        supports_pkce=True,
    ),
    "github": Provider(
        name="github",
        authorize_url="https://github.com/login/oauth/authorize",
        token_url="https://github.com/login/oauth/access_token",
        # `read:user` for the profile, `user:email` for the address behind it.
        # Deliberately nothing repository-scoped: SoftTrack's repository
        # integration is a webhook and a shared secret, and holds no token.
        scope="read:user user:email",
        _identity=_github_identity,
    ),
}


def credentials(name: str) -> tuple[str, str]:
    """The configured client id and secret for a provider, or two blanks."""
    return (
        getattr(settings, f"{name}_client_id", ""),
        getattr(settings, f"{name}_client_secret", ""),
    )


def is_configured(name: str) -> bool:
    """Whether the operator has given this provider both halves of its credentials.

    Both, because one without the other cannot complete a sign-in, and a
    button that always fails is worse than no button.
    """
    client_id, client_secret = credentials(name)
    return bool(client_id and client_secret)


def configured_providers() -> list[str]:
    """The providers this instance can actually sign somebody in with."""
    return [name for name in PROVIDERS if is_configured(name)]


def new_verifier() -> str:
    """A PKCE code verifier: 43-128 unreserved characters (RFC 7636 §4.1)."""
    return secrets.token_urlsafe(64)


def challenge_for(verifier: str) -> str:
    """The S256 challenge for a verifier, base64url with the padding stripped."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def authorization_url(
    provider: Provider, redirect_uri: str, state: str, verifier: str
) -> str:
    client_id, _ = credentials(provider.name)
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": provider.scope,
        "state": state,
        **provider.authorize_params,
    }
    if provider.supports_pkce:
        params["code_challenge"] = challenge_for(verifier)
        params["code_challenge_method"] = "S256"
    return f"{provider.authorize_url}?{urlencode(params)}"


def exchange_code(
    provider: Provider, code: str, redirect_uri: str, verifier: str
) -> str:
    """Trade the authorization code for an access token.

    The client secret goes in the body rather than in Basic auth because
    GitHub documents it that way and Google accepts both.
    """
    client_id, client_secret = credentials(provider.name)
    form = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
        "client_secret": client_secret,
    }
    if provider.supports_pkce:
        form["code_verifier"] = verifier

    try:
        with http_client() as client:
            response = client.post(
                provider.token_url,
                data=form,
                # GitHub answers form-encoded unless asked otherwise, and its
                # errors arrive as 200s -- see `_json`.
                headers={"Accept": "application/json"},
            )
    except httpx.HTTPError:
        # DNS, connect, timeout, a proxy hanging up. `from None` is not
        # decoration: the suppressed exception's innermost frame is this
        # function, whose `form` local holds the client secret, and an
        # unhandled error here would put that whole chain in the server log.
        raise OAuthError("exchange_failed") from None
    body = _json(response)

    if not isinstance(body, dict):
        raise OAuthError("exchange_failed")
    token = body.get("access_token")
    if not token:
        raise OAuthError("exchange_failed")
    return str(token)


def fetch_identity(provider: Provider, access_token: str) -> OAuthIdentity:
    try:
        with http_client() as client:
            return provider._identity(client, access_token)
    except httpx.HTTPError:
        raise OAuthError("profile_failed") from None


def http_client() -> httpx.Client:
    """The outbound client, in one place so tests can hand over a transport."""
    return httpx.Client(timeout=HTTP_TIMEOUT_SECONDS, follow_redirects=False)


def _json(response: httpx.Response) -> dict | list:
    """A provider's JSON body, or an OAuthError.

    Two failures are folded together on purpose. A non-2xx is obviously a
    failure; so is a 200 carrying `{"error": ...}`, which is how GitHub reports
    a bad or reused authorization code. Nothing from the body is passed on --
    an error from a token endpoint can echo the request back, and the request
    contains the client secret.
    """
    if response.status_code >= 400:
        raise OAuthError("exchange_failed")
    try:
        body = response.json()
    except ValueError:
        raise OAuthError("exchange_failed")
    if isinstance(body, dict) and body.get("error"):
        raise OAuthError("exchange_failed")
    return body

"""Signing in with Google and GitHub.

The provider is the one thing these tests cannot have, so it is replaced at the
lowest level that is still honest: `oauth_providers.http_client` hands back an
`httpx.Client` wired to a `MockTransport`, which means the token exchange, the
profile parsing and GitHub's separate address call all run for real against
canned responses. Stubbing `fetch_identity` instead would have tested the flow
and skipped every line that reads what a provider actually said.
"""

from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from lib_identity import oauth_providers
from web import settings

GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo"
GITHUB_TOKEN = "https://github.com/login/oauth/access_token"
GITHUB_USER = "https://api.github.com/user"
GITHUB_EMAILS = "https://api.github.com/user/emails"

#: Stands in for the random value the frontend puts in `sessionStorage`.
HANDSHAKE = "a-handshake-the-browser-kept"


@pytest.fixture
def configured(monkeypatch):
    """An instance with both providers set up."""
    monkeypatch.setattr(settings, "google_client_id", "google-client")
    monkeypatch.setattr(settings, "google_client_secret", "google-secret")
    monkeypatch.setattr(settings, "github_client_id", "github-client")
    monkeypatch.setattr(settings, "github_client_secret", "github-secret")


@pytest.fixture
def provider(monkeypatch):
    """What the providers will say. Mutate it in a test to change the answer."""
    canned = {
        "token_status": 200,
        "token_body": {"access_token": "provider-access-token"},
        "google": {
            "sub": "google-subject-1",
            "email": "sam@example.com",
            "email_verified": True,
            "name": "Sam Example",
        },
        "github_user": {"id": 4242, "name": "Sam Example", "login": "sam"},
        "emails_status": 200,
        "github_emails": [
            {"email": "other@example.com", "primary": False, "verified": True},
            {"email": "sam@example.com", "primary": True, "verified": True},
        ],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url in (GOOGLE_TOKEN, GITHUB_TOKEN):
            return httpx.Response(canned["token_status"], json=canned["token_body"])
        if url == GOOGLE_USERINFO:
            return httpx.Response(200, json=canned["google"])
        if url == GITHUB_USER:
            return httpx.Response(200, json=canned["github_user"])
        if url == GITHUB_EMAILS:
            return httpx.Response(canned["emails_status"], json=canned["github_emails"])
        raise AssertionError(f"unexpected outbound request to {url}")

    monkeypatch.setattr(
        oauth_providers,
        "http_client",
        lambda: httpx.Client(transport=httpx.MockTransport(handler)),
    )
    return canned


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def start(client, name="google", handshake=HANDSHAKE, **params):
    return client.get(
        f"/auth/oauth/{name}/start",
        params={"hs": handshake, **params},
        follow_redirects=False,
    )


def state_of(response) -> str:
    return parse_qs(urlparse(response.headers["location"]).query)["state"][0]


def sign_in(client, name="google", handshake=HANDSHAKE, **params):
    """Out to the provider and back. Returns the callback's redirect."""
    started = start(client, name, handshake, **params)
    assert started.status_code == 303, started.text
    return client.get(
        f"/auth/oauth/{name}/callback",
        params={"code": "authorization-code", "state": state_of(started)},
        follow_redirects=False,
    )


def landed_on(response) -> tuple[str, dict]:
    """`(path, fragment-or-query params)` from a redirect back to the app."""
    parsed = urlparse(response.headers["location"])
    raw = parsed.fragment or parsed.query
    return parsed.path, {k: v[0] for k, v in parse_qs(raw).items()}


def redeem(client, response, handshake=HANDSHAKE):
    """The second half of a sign-in: ticket plus handshake for a session."""
    _, params = landed_on(response)
    return client.post(
        "/auth/oauth/exchange",
        json={"ticket": params["ticket"], "handshake": handshake},
    )


def headers_for(client, response, handshake=HANDSHAKE) -> dict:
    exchanged = redeem(client, response, handshake)
    assert exchanged.status_code == 200, exchanged.text
    return {"Authorization": f"Bearer {exchanged.json()['access_token']}"}


def signed_in(client, name="google", **params) -> dict:
    """A completed sign-in, as auth headers."""
    return headers_for(client, sign_in(client, name, **params))


# ---------------------------------------------------------------------------
# What the signed-out pages are told
# ---------------------------------------------------------------------------


def test_config_lists_only_providers_with_both_halves(client, monkeypatch):
    assert client.get("/auth/config").json()["oauth_providers"] == []

    # An id without a secret cannot finish a sign-in, so the button would only
    # ever fail. Half-configured reads as not configured.
    monkeypatch.setattr(settings, "github_client_id", "github-client")
    assert client.get("/auth/config").json()["oauth_providers"] == []

    monkeypatch.setattr(settings, "github_client_secret", "github-secret")
    assert client.get("/auth/config").json()["oauth_providers"] == ["github"]


# ---------------------------------------------------------------------------
# Leaving
# ---------------------------------------------------------------------------


def test_start_redirects_to_google_with_state_and_pkce(client, configured):
    response = start(client, "google", next="/ENG")
    assert response.status_code == 303

    url = urlparse(response.headers["location"])
    assert f"{url.scheme}://{url.netloc}{url.path}" == (
        "https://accounts.google.com/o/oauth2/v2/auth"
    )
    query = parse_qs(url.query)
    assert query["client_id"] == ["google-client"]
    assert query["response_type"] == ["code"]
    assert query["redirect_uri"] == ["http://localhost:8000/auth/oauth/google/callback"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["code_challenge"][0]
    # Neither the verifier nor the handshake may be shown to the provider --
    # `state` is a bare nonce for exactly this reason, and signed is not
    # encrypted.
    assert "code_verifier" not in query
    assert HANDSHAKE not in response.headers["location"]
    assert response.cookies.get("softtrack_oauth")


def test_start_does_not_offer_github_a_challenge_it_ignores(client, configured):
    """GitHub's OAuth apps do not implement PKCE, so nothing pretends they do."""
    query = parse_qs(urlparse(start(client, "github").headers["location"]).query)
    assert "code_challenge" not in query
    assert query["scope"] == ["read:user user:email"]


def test_start_without_a_handshake_is_refused(client, configured):
    """There is no legitimate caller without one -- see the exchange tests."""
    response = start(client, "google", handshake="")
    path, params = landed_on(response)
    assert path == "/login"
    assert params["error"] == "state"


def test_an_unconfigured_provider_answers_a_page_not_a_json_body(client):
    """A browser navigated here. A 404 body would be rendered as text."""
    response = start(client, "google")
    assert response.status_code == 303
    path, params = landed_on(response)
    assert path == "/login"
    assert params["error"] == "unavailable"


def test_a_provider_that_does_not_exist_answers_the_same(client, configured):
    assert landed_on(start(client, "gitlab"))[1]["error"] == "unavailable"


def test_an_offsite_next_is_dropped_at_the_start(client, configured, provider):
    """Refused where it enters, not only where it is used."""
    response = sign_in(client, next="https://elsewhere.example/steal")
    path, params = landed_on(response)
    assert path == "/oauth/callback"
    assert params["next"] == "/"


# ---------------------------------------------------------------------------
# Coming back: a new account
# ---------------------------------------------------------------------------


def test_a_first_sign_in_creates_an_account_with_no_password(
    client, configured, provider
):
    response = sign_in(client, next="/ENG")
    path, params = landed_on(response)
    assert path == "/oauth/callback"
    assert params["next"] == "/ENG"
    # The session itself is never in the URL. What is there is worthless
    # without the handshake that stayed in the tab.
    assert "token" not in params

    me = client.get("/auth/me", headers=headers_for(client, response))
    assert me.status_code == 200
    body = me.json()
    assert body["email"] == "sam@example.com"
    assert body["full_name"] == "Sam Example"
    assert body["username"] == "sam"
    # The whole point of the sentinel: there is no password, and the app says
    # so rather than pretending there is one nobody knows.
    assert body["has_password"] is False


def test_the_first_account_owns_the_instance_however_it_arrived(
    client, configured, provider
):
    assert client.get("/auth/me", headers=signed_in(client)).json()["is_site_admin"]


def test_an_oauth_only_account_cannot_be_signed_into_with_a_password(
    client, configured, provider
):
    signed_in(client)
    response = client.post(
        "/auth/login", data={"username": "sam@example.com", "password": "password123"}
    )
    assert response.status_code == 401


def test_a_returning_identity_is_matched_on_the_subject_not_the_address(
    client, configured, provider
):
    """Somebody who changes their Google address keeps their account."""
    first = signed_in(client)
    user_id = client.get("/auth/me", headers=first).json()["id"]

    provider["google"]["email"] = "sam.example@newdomain.example"
    second = signed_in(client)
    assert client.get("/auth/me", headers=second).json()["id"] == user_id

    # And the connected-accounts list follows the address to where it is now.
    identities = client.get("/auth/me/identities", headers=second).json()
    assert [i["email"] for i in identities] == ["sam.example@newdomain.example"]


# ---------------------------------------------------------------------------
# Linking to an account that already exists
# ---------------------------------------------------------------------------


def test_a_verified_address_joins_an_account_a_provider_made(
    client, configured, provider
):
    """The automatic link, in the one case where both sides of the address
    have been verified: the account itself was created by a provider."""
    google = signed_in(client)
    user_id = client.get("/auth/me", headers=google).json()["id"]

    # Same person, same verified address, now through GitHub.
    github = signed_in(client, "github")
    assert client.get("/auth/me", headers=github).json()["id"] == user_id
    assert sorted(
        i["provider"] for i in client.get("/auth/me/identities", headers=github).json()
    ) == ["github", "google"]


def test_the_address_is_matched_without_regard_to_case(client, configured, provider):
    signed_in(client)
    provider["github_emails"] = [
        {"email": "Sam@Example.com", "primary": True, "verified": True}
    ]
    identities = client.get(
        "/auth/me/identities", headers=signed_in(client, "github")
    ).json()
    assert len(identities) == 2


def test_an_account_with_a_password_is_never_joined_automatically(
    client, auth, configured, provider
):
    """The account pre-hijacking hole, closed.

    SoftTrack has never confirmed that whoever typed an address at
    /auth/register can read mail sent to it. So a row with a password is a
    claim, not a fact: anybody could have registered `sam@example.com` first
    and kept the password. Joining a verified Google identity to it would hand
    them everything Sam does afterwards.
    """
    auth(email="sam@example.com", full_name="Sam Example")

    path, params = landed_on(sign_in(client))
    assert path == "/login"
    assert params["error"] == "account_exists"
    assert client.get("/auth/me/identities").status_code == 401


def test_a_reassigned_address_does_not_inherit_the_previous_holders_account(
    client, configured, provider
):
    """A Workspace seat handed to somebody new: same address, new `sub`."""
    signed_in(client)

    provider["google"]["sub"] = "google-subject-2"
    path, params = landed_on(sign_in(client))
    assert path == "/login"
    # Not `account_exists`: that one tells you to use your password, and this
    # account has none. See the message table in frontend/src/auth/oauth.ts.
    assert params["error"] == "connect_required"


def test_an_unverified_address_never_reaches_an_existing_account(
    client, configured, provider
):
    """The other half of the same rule: the provider's side has to hold too."""
    signed_in(client)
    provider["github_emails"] = [
        {"email": "sam@example.com", "primary": True, "verified": False}
    ]
    provider["github_user"]["email"] = "sam@example.com"

    path, params = landed_on(sign_in(client, "github"))
    assert path == "/login"
    assert params["error"] == "email_unverified"


def test_an_unverified_address_does_not_create_an_account_either(
    client, configured, provider
):
    """Otherwise it could squat an address the real owner has yet to register."""
    provider["google"]["email_verified"] = False
    path, params = landed_on(sign_in(client))
    assert path == "/login"
    assert params["error"] == "email_unverified"
    assert (
        client.post(
            "/auth/register",
            json={
                "email": "sam@example.com",
                "password": "password123",
                "full_name": "The Real Sam",
            },
        ).status_code
        == 200
    )


def test_a_deactivated_account_is_refused(client, auth, configured, provider):
    owner = auth(email="owner@softtrack.dev")
    sam = auth(email="sam@example.com")
    client.patch(
        f"/admin/users/{sam['user']['id']}",
        json={"is_active": False},
        headers=owner["headers"],
    )

    path, params = landed_on(sign_in(client))
    assert path == "/login"
    # Before `account_exists`, because it is the more useful answer and both
    # say the same amount about whether the address is in use.
    assert params["error"] == "deactivated"


def test_a_linked_account_deactivated_later_is_refused_too(
    client, auth, configured, provider
):
    owner = auth(email="owner@softtrack.dev")
    user_id = client.get("/auth/me", headers=signed_in(client)).json()["id"]

    client.patch(
        f"/admin/users/{user_id}",
        json={"is_active": False},
        headers=owner["headers"],
    )

    assert landed_on(sign_in(client))[1]["error"] == "deactivated"


# ---------------------------------------------------------------------------
# Redeeming the ticket
# ---------------------------------------------------------------------------


def test_a_ticket_is_worthless_without_the_handshake(client, configured, provider):
    """Login CSRF, closed.

    Without this, a link of the form /oauth/callback#ticket=... mailed to
    somebody would silently sign them into the sender's account, and they
    would file their bugs inside it.
    """
    response = sign_in(client)
    assert redeem(client, response, handshake="some-other-browser").status_code == 400
    assert redeem(client, response, handshake="").status_code == 422
    # The right one still works, so the ticket was not the problem.
    assert redeem(client, response).status_code == 200


def test_a_ticket_is_not_an_access_token(client, configured, provider):
    _, params = landed_on(sign_in(client))
    response = client.get(
        "/auth/me", headers={"Authorization": f"Bearer {params['ticket']}"}
    )
    assert response.status_code == 401


def test_a_ticket_dies_with_the_session_it_was_minted_for(client, configured, provider):
    response = sign_in(client)
    headers = headers_for(client, response)
    # Redeeming is not single-use on its own -- it is stateless -- so anything
    # that revokes tokens has to revoke these too.
    client.post("/auth/me/sign-out-everywhere", headers=headers)
    assert redeem(client, response).status_code == 400


def test_a_garbage_ticket_is_refused(client):
    response = client.post(
        "/auth/oauth/exchange", json={"ticket": "not-a-jwt", "handshake": HANDSHAKE}
    )
    assert response.status_code == 400


def test_an_access_token_cannot_be_redeemed_as_a_ticket(client, auth):
    """All three blobs share one signing key, so `typ` has to separate them."""
    actor = auth(email="sam@example.com")
    token = actor["headers"]["Authorization"].removeprefix("Bearer ")
    response = client.post(
        "/auth/oauth/exchange", json={"ticket": token, "handshake": HANDSHAKE}
    )
    assert response.status_code == 400


# ---------------------------------------------------------------------------
# The gate on a closed instance
# ---------------------------------------------------------------------------


def test_a_closed_instance_refuses_an_address_it_never_invited(
    client, auth, configured, provider, monkeypatch
):
    auth(email="owner@softtrack.dev")
    monkeypatch.setattr(settings, "open_registration", False)

    assert landed_on(sign_in(client))[1]["error"] == "closed"


def test_a_closed_instance_admits_an_invited_address(
    client, team, configured, provider, monkeypatch
):
    invite = client.post(
        f"/teams/{team['team']['id']}/invites",
        json={"email": "sam@example.com", "role": "member"},
        headers=team["headers"],
    )
    assert invite.status_code == 200, invite.text
    monkeypatch.setattr(settings, "open_registration", False)

    response = sign_in(client, invite=invite.json()["token"])
    assert landed_on(response)[0] == "/oauth/callback"

    # And the invitation was spent, exactly as registering through the link is.
    teams = client.get("/teams", headers=headers_for(client, response)).json()
    assert [t["key"] for t in teams] == ["ENG"]


def test_an_invited_address_without_the_link_still_gets_in(
    client, team, configured, provider, monkeypatch
):
    """The gate is the invitation, not the token -- same rule as /auth/register."""
    client.post(
        f"/teams/{team['team']['id']}/invites",
        json={"email": "sam@example.com", "role": "member"},
        headers=team["headers"],
    )
    monkeypatch.setattr(settings, "open_registration", False)

    response = sign_in(client)
    assert landed_on(response)[0] == "/oauth/callback"
    # Not in the team yet -- the invitation is waiting on /auth/me/invites for
    # the banner to offer, which is what the register page does too.
    waiting = client.get(
        "/auth/me/invites", headers=headers_for(client, response)
    ).json()
    assert [i["team_key"] for i in waiting] == ["ENG"]


# ---------------------------------------------------------------------------
# GitHub's second call
# ---------------------------------------------------------------------------


def test_github_uses_the_primary_verified_address(client, configured, provider):
    assert (
        client.get("/auth/me", headers=signed_in(client, "github")).json()["email"]
        == "sam@example.com"
    )


def test_github_falls_back_to_any_verified_address(client, configured, provider):
    """An account whose primary is unverified still has one GitHub confirmed."""
    provider["github_emails"] = [
        {"email": "unconfirmed@example.com", "primary": True, "verified": False},
        {"email": "confirmed@example.com", "primary": False, "verified": True},
    ]
    assert (
        client.get("/auth/me", headers=signed_in(client, "github")).json()["email"]
        == "confirmed@example.com"
    )


def test_github_without_the_email_scope_is_refused(client, configured, provider):
    """`/user/emails` answers 403, and the public address is not a verified one."""
    provider["emails_status"] = 403
    provider["github_emails"] = {"message": "Requires authentication"}
    provider["github_user"]["email"] = "public@example.com"

    assert landed_on(sign_in(client, "github"))[1]["error"] == "email_unverified"


def test_github_with_no_address_at_all_is_refused(client, configured, provider):
    provider["github_emails"] = []
    assert landed_on(sign_in(client, "github"))[1]["error"] == "no_email"


# ---------------------------------------------------------------------------
# Refusals in the middle of the round trip
# ---------------------------------------------------------------------------


def test_a_callback_without_the_state_cookie_is_refused(client, configured, provider):
    started = start(client, "google")
    client.cookies.clear()
    response = client.get(
        "/auth/oauth/google/callback",
        params={"code": "authorization-code", "state": state_of(started)},
        follow_redirects=False,
    )
    assert landed_on(response)[1]["error"] == "state"


def test_a_forged_state_is_refused(client, configured, provider):
    """The cookie is genuine; the `state` coming back is not this browser's."""
    start(client, "google")
    response = client.get(
        "/auth/oauth/google/callback",
        params={"code": "authorization-code", "state": "not-the-nonce"},
        follow_redirects=False,
    )
    assert landed_on(response)[1]["error"] == "state"


def test_a_state_cookie_from_another_provider_is_refused(client, configured, provider):
    started = start(client, "google")
    response = client.get(
        "/auth/oauth/github/callback",
        params={"code": "authorization-code", "state": state_of(started)},
        follow_redirects=False,
    )
    assert landed_on(response)[1]["error"] == "state"


def test_an_access_token_is_not_a_state_cookie(client, auth, configured, provider):
    actor = auth(email="sam@example.com")
    token = actor["headers"]["Authorization"].removeprefix("Bearer ")
    client.cookies.set("softtrack_oauth", token, path="/auth")

    response = client.get(
        "/auth/oauth/google/callback",
        params={"code": "authorization-code", "state": "anything"},
        follow_redirects=False,
    )
    assert landed_on(response)[1]["error"] == "state"


def test_a_state_cookie_is_not_an_access_token(client, configured):
    """And the other direction: it carries no subject, so it authenticates nobody."""
    cookie = start(client, "google").cookies["softtrack_oauth"]
    assert (
        client.get(
            "/auth/me", headers={"Authorization": f"Bearer {cookie}"}
        ).status_code
        == 401
    )


def test_cancelling_at_the_provider_comes_back_quietly(client, configured):
    response = client.get(
        "/auth/oauth/google/callback",
        params={"error": "access_denied"},
        follow_redirects=False,
    )
    path, params = landed_on(response)
    assert path == "/login"
    assert params["error"] == "cancelled"


def test_a_failed_exchange_does_not_leak_what_the_provider_said(
    client, configured, provider
):
    """GitHub reports a spent code as a 200 with an `error` key."""
    provider["token_body"] = {
        "error": "bad_verification_code",
        "error_description": "The code passed is incorrect or expired.",
    }
    response = sign_in(client)
    assert landed_on(response)[1]["error"] == "exchange_failed"
    assert "bad_verification_code" not in response.headers["location"]


def test_a_profile_call_that_answers_nonsense_is_refused(client, configured, provider):
    provider["google"] = {"email": "sam@example.com", "email_verified": True}
    assert landed_on(sign_in(client))[1]["error"] == "profile_failed"


# ---------------------------------------------------------------------------
# Connecting from Settings
# ---------------------------------------------------------------------------


def link_ticket(client, headers, name="google") -> str:
    response = client.post(f"/auth/oauth/{name}/link-ticket", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["ticket"]


def start_connect(client, headers, name="google", **params):
    """The round trip half of pressing Connect. Returns the callback redirect.

    Nothing is written by this: the callback hands back a result that only a
    live session for the same account can spend.
    """
    ticket = link_ticket(client, headers, name)
    return sign_in(client, name, ticket=ticket, next="/settings/security", **params)


def finish_connect(client, headers, response):
    """The authenticated half: spend the result the callback handed back."""
    _, fragment = landed_on(response)
    return client.post(
        "/auth/oauth/link", json={"ticket": fragment["link"]}, headers=headers
    )


def connect(client, headers, name="google", **params):
    """Both halves, for the tests that only care that it worked."""
    response = start_connect(client, headers, name, **params)
    assert landed_on(response)[0] == "/oauth/callback", response.headers["location"]
    applied = finish_connect(client, headers, response)
    assert applied.status_code == 200, applied.text
    return applied


def test_connecting_attaches_the_provider_to_the_signed_in_account(
    client, auth, configured, provider
):
    """The case the automatic link deliberately refuses, done properly.

    The session is the proof here, not the address -- which is also why the two
    addresses are allowed to differ.
    """
    actor = auth(email="sam@corp.example", full_name="Sam Example")

    assert connect(client, actor["headers"]).json()["provider"] == "google"
    # Still signed in as the same person, with the password intact.
    me = client.get("/auth/me", headers=actor["headers"]).json()
    assert me["email"] == "sam@corp.example"
    assert me["has_password"] is True

    identities = client.get("/auth/me/identities", headers=actor["headers"]).json()
    assert [i["provider"] for i in identities] == ["google"]
    assert identities[0]["email"] == "sam@example.com"

    # ...and now the button on the sign-in page works for them.
    assert (
        client.get("/auth/me", headers=signed_in(client)).json()["id"]
        == actor["user"]["id"]
    )


def test_connecting_never_signs_you_into_somebody_elses_account(
    client, auth, configured, provider
):
    """A plain sign-in here would have resolved to the *other* account."""
    stranger = signed_in(client)
    stranger_id = client.get("/auth/me", headers=stranger).json()["id"]
    actor = auth(email="different@corp.example")

    refused = finish_connect(
        client, actor["headers"], start_connect(client, actor["headers"])
    )
    assert refused.status_code == 409
    assert client.get("/auth/me", headers=actor["headers"]).json()["id"] != stranger_id
    assert client.get("/auth/me/identities", headers=actor["headers"]).json() == []


def test_a_link_ticket_dies_with_the_session_that_asked_for_it(
    client, auth, configured, provider
):
    actor = auth(email="sam@corp.example")
    ticket = link_ticket(client, actor["headers"])
    client.post("/auth/me/sign-out-everywhere", headers=actor["headers"])

    response = sign_in(client, ticket=ticket, next="/settings/security")
    assert landed_on(response)[1]["error"] == "link_expired"


def test_a_link_ticket_for_one_provider_does_not_work_on_another(
    client, auth, configured, provider
):
    actor = auth(email="sam@corp.example")
    ticket = link_ticket(client, actor["headers"], "google")

    response = start(client, "github", ticket=ticket, next="/settings/security")
    path, params = landed_on(response)
    assert path == "/settings/security"
    assert params["error"] == "link_expired"


def test_minting_a_link_ticket_needs_a_session(client, configured):
    assert client.post("/auth/oauth/google/link-ticket").status_code == 401


def test_connecting_a_second_google_replaces_the_first(
    client, auth, configured, provider
):
    """Deliberate, authenticated, and one row: two keys to one door is what
    makes `DELETE /auth/me/identities/google` ambiguous."""
    actor = auth(email="sam@corp.example")
    connect(client, actor["headers"])

    provider["google"]["sub"] = "google-subject-2"
    provider["google"]["email"] = "other@example.com"
    assert connect(client, actor["headers"]).json()["provider"] == "google"

    identities = client.get("/auth/me/identities", headers=actor["headers"]).json()
    assert len(identities) == 1
    assert identities[0]["email"] == "other@example.com"


# ---------------------------------------------------------------------------
# Connected accounts
# ---------------------------------------------------------------------------


def test_identities_are_listed_and_can_be_disconnected(
    client, auth, configured, provider
):
    actor = auth(email="sam@corp.example")
    connect(client, actor["headers"])

    listed = client.get("/auth/me/identities", headers=actor["headers"]).json()
    assert len(listed) == 1
    assert listed[0]["provider"] == "google"
    assert listed[0]["last_login_at"]

    assert (
        client.delete(
            "/auth/me/identities/google", headers=actor["headers"]
        ).status_code
        == 204
    )
    assert client.get("/auth/me/identities", headers=actor["headers"]).json() == []


def test_disconnecting_something_that_is_not_connected_is_404(client, auth):
    actor = auth()
    assert (
        client.delete(
            "/auth/me/identities/github", headers=actor["headers"]
        ).status_code
        == 404
    )
    assert (
        client.delete(
            "/auth/me/identities/gitlab", headers=actor["headers"]
        ).status_code
        == 404
    )


def test_disconnecting_the_only_way_in_is_refused(client, configured, provider):
    headers = signed_in(client)
    refused = client.delete("/auth/me/identities/google", headers=headers)
    assert refused.status_code == 400
    assert "password" in refused.json()["detail"]


def test_a_password_makes_disconnecting_safe(client, configured, provider):
    headers = signed_in(client)

    set_password = client.post(
        "/auth/me/password", json={"new_password": "a-real-password"}, headers=headers
    )
    assert set_password.status_code == 200, set_password.text
    # Setting a password invalidates every other session, so carry on with the
    # token it just handed back.
    headers = {"Authorization": f"Bearer {set_password.json()['access_token']}"}

    assert (
        client.delete("/auth/me/identities/google", headers=headers).status_code == 204
    )
    assert (
        client.post(
            "/auth/login",
            data={"username": "sam@example.com", "password": "a-real-password"},
        ).status_code
        == 200
    )


def test_identities_need_a_token(client):
    assert client.get("/auth/me/identities").status_code == 401
    assert client.delete("/auth/me/identities/google").status_code == 401


# ---------------------------------------------------------------------------
# Living without a password
# ---------------------------------------------------------------------------


def test_an_account_with_no_password_can_change_its_email(client, configured, provider):
    """There is nothing to re-verify against, and it is not a field to lose."""
    response = client.patch(
        "/auth/me", json={"email": "moved@example.com"}, headers=signed_in(client)
    )
    assert response.status_code == 200, response.text
    assert response.json()["email"] == "moved@example.com"


def test_an_account_with_a_password_still_has_to_produce_it(client, auth):
    actor = auth(email="sam@example.com")
    response = client.patch(
        "/auth/me", json={"email": "moved@example.com"}, headers=actor["headers"]
    )
    assert response.status_code == 400


def test_changing_a_real_password_still_needs_the_old_one(client, auth):
    actor = auth(email="sam@example.com")
    response = client.post(
        "/auth/me/password",
        json={"current_password": "wrong", "new_password": "a-real-password"},
        headers=actor["headers"],
    )
    assert response.status_code == 400
    response = client.post(
        "/auth/me/password",
        json={"new_password": "a-real-password"},
        headers=actor["headers"],
    )
    assert response.status_code == 400


# ---------------------------------------------------------------------------
# Throttling
# ---------------------------------------------------------------------------


def test_starting_a_sign_in_is_throttled(client, configured):
    from lib_utils.rate_limit import oauth_by_address

    for _ in range(oauth_by_address.free_attempts + 1):
        start(client, "google")
    # Still a page, not a 429 body -- same reason as the refusals above.
    assert landed_on(start(client, "google"))[1]["error"] == "throttled"


def test_coming_back_from_a_provider_is_throttled_separately(
    client, configured, provider
):
    """The expensive half: each callback costs an outbound call to the provider.

    The state that authorises one is stateless, and "please drop this cookie"
    is only a request -- so a script holding one cookie can replay it forever
    unless this bucket exists.
    """
    from lib_utils.rate_limit import oauth_callback_by_address

    started = start(client, "google")
    for _ in range(oauth_callback_by_address.free_attempts + 1):
        client.get(
            "/auth/oauth/google/callback",
            params={"code": "spent", "state": state_of(started)},
            follow_redirects=False,
        )
    refused = client.get(
        "/auth/oauth/google/callback",
        params={"code": "spent", "state": state_of(started)},
        follow_redirects=False,
    )
    assert landed_on(refused)[1]["error"] == "throttled"


# ---------------------------------------------------------------------------
# The guards, directly
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "candidate",
    [
        "https://elsewhere.example/steal",
        # Protocol-relative, and the backslash form browsers normalise to it.
        "//elsewhere.example",
        "/\\elsewhere.example",
        # A newline would split the Location header.
        "/board\r\nSet-Cookie: a=b",
        "ENG",
        "",
        "/" + "x" * 600,
        None,
        42,
    ],
)
def test_only_a_path_on_this_site_survives_as_a_destination(candidate):
    """`next` starts life in somebody's address bar and ends in a `Location`."""
    from lib_identity.oauth import same_site_path

    assert same_site_path(candidate) == "/"


def test_a_real_destination_is_left_alone():
    from lib_identity.oauth import same_site_path

    assert same_site_path("/ENG/issue/42?tab=activity") == "/ENG/issue/42?tab=activity"


def test_an_unusable_password_can_never_be_verified():
    """The sentinel, and anything else that is not a bcrypt hash."""
    from lib_utils.password import (
        is_usable_password,
        unusable_password,
        verify_password,
    )

    sentinel = unusable_password()
    assert is_usable_password(sentinel) is False
    assert verify_password(sentinel, sentinel) is False
    assert verify_password("", "") is False
    # Not the sentinel, still not a hash -- bcrypt raises rather than answering.
    assert verify_password("password123", "$2b$12$not-a-real-salt") is False


def test_a_token_endpoint_that_answers_html_is_refused(client, configured, monkeypatch):
    """A captive portal, a proxy error page, a provider having a bad day."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html>sign in to the wifi</html>")

    monkeypatch.setattr(
        oauth_providers,
        "http_client",
        lambda: httpx.Client(transport=httpx.MockTransport(handler)),
    )
    assert landed_on(sign_in(client))[1]["error"] == "exchange_failed"


def test_github_answering_something_other_than_a_list_of_addresses(
    client, configured, provider
):
    """No usable address, rather than a crash on an unexpected shape."""
    provider["github_emails"] = {"message": "not a list"}
    assert landed_on(sign_in(client, "github"))[1]["error"] == "no_email"


def test_a_link_ticket_is_void_once_the_account_is_deactivated(
    client, auth, configured, provider
):
    owner = auth(email="owner@softtrack.dev")
    sam = auth(email="sam@corp.example")
    ticket = link_ticket(client, sam["headers"])

    client.patch(
        f"/admin/users/{sam['user']['id']}",
        json={"is_active": False},
        headers=owner["headers"],
    )

    response = sign_in(client, ticket=ticket, next="/settings/security")
    assert landed_on(response)[1]["error"] == "link_expired"


def test_an_invitation_for_a_different_address_lands_on_the_invitation(
    client, team, configured, provider
):
    """Sam was invited at work and pressed the button with a personal account.

    The requested destination would be a board they are not a member of. The
    invitation page is the one screen that can say what went wrong.
    """
    invite = client.post(
        f"/teams/{team['team']['id']}/invites",
        json={"email": "sam@corp.example", "role": "member"},
        headers=team["headers"],
    )
    token = invite.json()["token"]

    response = sign_in(client, invite=token, next="/ENG")
    _, params = landed_on(response)
    assert params["next"] == f"/invite/{token}"

    headers = headers_for(client, response)
    assert client.get("/teams", headers=headers).json() == []
    # ...and the invitation is still there for whoever it was meant for.
    assert client.get(f"/invites/{token}").status_code == 200


def test_signing_in_again_with_a_spent_invitation_goes_where_it_was_asked(
    client, team, configured, provider
):
    """Already a member: a dead invitation is not a reason to change course."""
    invite = client.post(
        f"/teams/{team['team']['id']}/invites",
        json={"email": "sam@example.com", "role": "member"},
        headers=team["headers"],
    )
    token = invite.json()["token"]

    sign_in(client, invite=token, next="/ENG")
    _, params = landed_on(sign_in(client, invite=token, next="/ENG"))
    assert params["next"] == "/ENG"


# ---------------------------------------------------------------------------
# The two holes the review found
# ---------------------------------------------------------------------------


def test_a_renamed_account_cannot_absorb_the_address_it_renamed_to(
    client, configured, provider
):
    """Pre-hijacking, one step along -- and closed.

    "Has no password" is evidence only at the moment an account is created.
    `PATCH /auth/me` then lets exactly those accounts rename themselves with
    nothing to confirm against, so the automatic link needs a claim a
    *provider* wrote rather than merely the absence of a password.
    """
    # Somebody arrives through GitHub as themselves...
    provider["github_emails"] = [
        {"email": "squatter@evil.example", "primary": True, "verified": True}
    ]
    squatter = signed_in(client, "github")
    squatter_id = client.get("/auth/me", headers=squatter).json()["id"]

    # ...and renames the account onto somebody who has never been here.
    renamed = client.patch(
        "/auth/me", json={"email": "victim@company.example"}, headers=squatter
    )
    assert renamed.status_code == 200, renamed.text

    # The victim's first ever "Continue with Google", honestly verified.
    provider["google"]["email"] = "victim@company.example"
    path, params = landed_on(sign_in(client))
    assert path == "/login"
    assert params["error"] == "connect_required"

    # Nothing was attached, and nobody was signed into anybody else's account.
    identities = client.get("/auth/me/identities", headers=squatter).json()
    assert [i["provider"] for i in identities] == ["github"]
    assert client.get("/auth/me", headers=squatter).json()["id"] == squatter_id


def test_a_stolen_link_ticket_cannot_attach_anything(
    client, auth, configured, provider
):
    """It rides in a query string, so it is treated as public.

    Completing the round trip with somebody else's ticket cannot be prevented
    -- the start endpoint has no session to check against. What can be
    prevented is the write, and it is: the result is spendable only by a live
    session for the account the ticket named.
    """
    victim = auth(email="victim@corp.example")
    thief = auth(email="thief@corp.example")

    stolen = link_ticket(client, victim["headers"])
    _, fragment = landed_on(sign_in(client, ticket=stolen, next="/settings/security"))
    assert "link" in fragment

    assert (
        client.post("/auth/oauth/link", json={"ticket": fragment["link"]}).status_code
        == 401
    )
    refused = client.post(
        "/auth/oauth/link",
        json={"ticket": fragment["link"]},
        headers=thief["headers"],
    )
    assert refused.status_code == 400

    assert client.get("/auth/me/identities", headers=victim["headers"]).json() == []
    assert client.get("/auth/me/identities", headers=thief["headers"]).json() == []


def test_a_finished_connect_dies_with_the_session_that_started_it(
    client, auth, configured, provider
):
    actor = auth(email="sam@corp.example")
    response = start_connect(client, actor["headers"])
    fresh = client.post("/auth/me/sign-out-everywhere", headers=actor["headers"])
    headers = {"Authorization": f"Bearer {fresh.json()['access_token']}"}

    # The tab that signed everything out stays usable -- but the connect it
    # left half-finished does not, because the result names a token version
    # that has since moved. Carried out with the *fresh* token on purpose, so
    # this tests that check rather than the bearer token's own.
    assert finish_connect(client, headers, response).status_code == 400
    assert client.get("/auth/me/identities", headers=headers).json() == []


# ---------------------------------------------------------------------------
# One signing key, four kinds of blob
# ---------------------------------------------------------------------------


def _signed(claims: dict) -> str:
    """A blob with this instance's real key and real claims. Only `typ` varies."""
    from datetime import datetime, timedelta, timezone

    from jose import jwt

    return jwt.encode(
        {**claims, "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
        settings.secret_key,
        algorithm=settings.algorithm,
    )


def test_only_typ_separates_a_ticket_from_a_session(client, auth):
    """Everything here is signed with the one key, so `typ` is the whole fence.

    Each pair below differs in nothing but that claim, which is what makes this
    a test of the mechanism rather than of the claim shapes.
    """
    import hashlib

    actor = auth(email="sam@example.com")
    uid = actor["user"]["id"]
    handshake = "a-handshake"
    ticket_claims = {
        "uid": uid,
        "ver": 0,
        "hs": hashlib.sha256(handshake.encode()).hexdigest(),
    }

    def redeem_as(typ):
        return client.post(
            "/auth/oauth/exchange",
            json={
                "ticket": _signed({**ticket_claims, "typ": typ}),
                "handshake": handshake,
            },
        ).status_code

    assert redeem_as("oauth_exchange") == 200
    for typ in ("access", "oauth_state", "oauth_link", "oauth_link_result"):
        assert redeem_as(typ) == 400, typ

    def me_as(typ):
        blob = _signed({"sub": str(uid), "ver": 0, "typ": typ})
        return client.get(
            "/auth/me", headers={"Authorization": f"Bearer {blob}"}
        ).status_code

    assert me_as("access") == 200
    for typ in ("oauth_exchange", "oauth_state", "oauth_link", "oauth_link_result"):
        assert me_as(typ) == 401, typ


def test_only_typ_lets_a_cookie_authorise_a_callback(client, configured, provider):
    nonce = "the-nonce-this-browser-was-given"
    state_claims = {
        "provider": "google",
        "nonce": nonce,
        "verifier": "a-verifier",
        "hs": "a-digest",
        "next": "/",
        "invite": None,
        "link_user_id": None,
        "link_ver": None,
    }

    def callback_with(typ):
        client.cookies.set(
            "softtrack_oauth", _signed({**state_claims, "typ": typ}), path="/auth"
        )
        response = client.get(
            "/auth/oauth/google/callback",
            params={"code": "authorization-code", "state": nonce},
            follow_redirects=False,
        )
        client.cookies.clear()
        return landed_on(response)

    for typ in ("access", "oauth_exchange", "oauth_link", "oauth_link_result"):
        assert callback_with(typ)[1]["error"] == "state", typ

    # The very same claims, stamped correctly, get all the way through.
    assert callback_with("oauth_state")[0] == "/oauth/callback"


def test_a_provider_that_cannot_be_reached_is_a_page_not_a_crash(
    client, configured, monkeypatch
):
    """A 500 here would put the client secret in the server log.

    `exchange_code`'s innermost frame holds the request body, secret included,
    so a transport failure has to be converted where that local is in scope.
    """

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route to host", request=request)

    monkeypatch.setattr(
        oauth_providers,
        "http_client",
        lambda: httpx.Client(transport=httpx.MockTransport(refuse)),
    )
    response = sign_in(client)
    assert response.status_code == 303
    assert landed_on(response)[1]["error"] == "exchange_failed"
    assert "google-secret" not in response.headers["location"]


def test_a_provider_answering_a_json_array_is_a_page_not_a_crash(
    client, configured, monkeypatch
):
    def array(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[1, 2, 3])

    monkeypatch.setattr(
        oauth_providers,
        "http_client",
        lambda: httpx.Client(transport=httpx.MockTransport(array)),
    )
    assert landed_on(sign_in(client))[1]["error"] == "exchange_failed"


def test_a_connect_that_expires_is_reported_on_settings(
    client, auth, configured, provider, monkeypatch
):
    """The likeliest failure of all, on the page the person is looking at.

    The cookie deliberately outlives the token inside it so that this still
    knows which page started the round trip.
    """
    # Already past by the time the browser comes back -- which is what waiting
    # at a consent screen for eleven minutes looks like. The cookie's own
    # max_age is deliberately longer, so it is still there to be read.
    monkeypatch.setattr(settings, "oauth_state_expire_minutes", -1)
    actor = auth(email="sam@corp.example")
    response = start_connect(client, actor["headers"])

    path, params = landed_on(response)
    assert path == "/settings/security"
    assert params["error"] == "state"


def test_an_unexpected_service_refusal_is_still_a_page(
    client, configured, provider, monkeypatch
):
    """The backstop in the callback, which nothing currently reaches.

    Worth pinning anyway: it is the difference between a person seeing the
    sign-in page and a person seeing `{"detail": "..."}` in their address bar.
    """
    from fastapi import HTTPException

    from lib_identity import oauth as oauth_service

    def refuse(*args, **kwargs):
        raise HTTPException(status_code=400, detail="something the service refused")

    monkeypatch.setattr(oauth_service, "resolve_user", refuse)

    response = sign_in(client)
    path, params = landed_on(response)
    assert path == "/login"
    assert params["error"] == "failed"
    assert "something the service refused" not in response.headers["location"]

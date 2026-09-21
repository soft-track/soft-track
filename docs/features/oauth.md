# Signing in with Google and GitHub

Email and password still work, and on an instance that configures neither
provider nothing about the sign-in page changes — no buttons, no divider, no
hint that a feature is missing. That is deliberate: SoftTrack is meant to be
self-hostable with no dependency on anything outside your own network, and the
default stays that way.

Where a provider *is* configured, **Continue with Google** and **Continue with
GitHub** appear above the sign-in form, above the sign-up form and on an
invitation page, and **Settings → Security → Connected accounts** shows which
ones can sign in as you.

## Setting it up

Both providers need a redirect URI, and it has to match character for
character. SoftTrack builds it from `API_BASE_URL` — the address *the API* is
reachable at, not the frontend:

```
{API_BASE_URL}/auth/oauth/google/callback
{API_BASE_URL}/auth/oauth/github/callback
```

On a laptop that is `http://localhost:8000/auth/oauth/google/callback`. Getting
`API_BASE_URL` wrong is the failure people hit first, and it surfaces as the
provider refusing the redirect rather than as anything SoftTrack can explain.

**Google** — in the [Google Cloud console](https://console.cloud.google.com/apis/credentials),
create an *OAuth client ID* of type *Web application*, add the redirect URI
above, and set:

```bash
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
```

**GitHub** — in [Developer settings → OAuth Apps](https://github.com/settings/developers),
register a new application with that redirect URI as its *Authorization
callback URL*, and set:

```bash
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

A provider needs **both** halves to appear. An id without a secret cannot
finish a sign-in, so half-configured is treated as not configured rather than
as a button that always fails.

Nothing else is required. `docker compose up` passes all four through, and
`/auth/config` tells the sign-in page which buttons to draw.

## What happens when somebody presses the button

1. The page generates a random **handshake**, keeps it in `sessionStorage`, and
   sends the browser to `/auth/oauth/{provider}/start` with its value.
2. That endpoint mints an anti-forgery nonce and a
   [PKCE](https://datatracker.ietf.org/doc/html/rfc7636) verifier, puts them
   and the handshake's digest into a signed `HttpOnly` cookie lasting ten
   minutes, and redirects to the provider.
3. The provider sends the browser back to `/auth/oauth/{provider}/callback`,
   which checks the `state` it returned against the nonce in the cookie, trades
   the authorization code for an access token, and asks who this is.
4. SoftTrack resolves that to an account (below) and redirects to
   `/oauth/callback#ticket=…` on the frontend.
5. That page posts the ticket **and** the handshake to `/auth/oauth/exchange`,
   and gets the session back in a JSON body.

Coming back from *Connect* is the same shape with a different last step: the
callback writes nothing and hands back `#link=…`, which the page posts to
`/auth/oauth/link` with the session it already holds.

Three choices there are worth knowing about.

**The half-finished sign-in lives in a signed cookie, not a table.** Nothing to
sweep, and nothing that breaks when you run more than one worker.

**Nothing that appears in a URL is a credential on its own.** What comes back
from the callback is a two-minute ticket, and both kinds are inert by
themselves: a sign-in ticket needs the handshake, which never left the tab that
started it, and a connect result needs a live session for the account it names.
Without the first, a `/oauth/callback#token=…` link mailed to somebody would
silently sign them into the sender's account, and they would file their bugs
into a workspace someone else owns. Without the second, the ticket that opens a
connect — which rides in a query string, and so is in this API's access log and
the browser's history — would be enough to bolt a permanent key onto somebody
else's account.

**The frontend's callback path is `/oauth/callback`, not `/auth/callback`.**
`/auth` is the API's prefix, and a single-domain deployment that proxies it to
FastAPI would 404 on every sign-in.

## Which account you end up in

In this order, and no other:

1. **The provider account is already connected.** You are signed in as its
   owner. The match is on the provider's own immutable id for the account,
   never on the address — so changing your email on either side keeps your
   SoftTrack account, and inheriting a departed colleague's mailbox does not
   inherit their account with it.
2. **It is not connected, the provider has *verified* an address, and an
   account here uses that address, has no password, and already has a
   different provider vouching for the same address.** The two are joined and
   you are signed in. This is what makes "I signed up with Google, now let me
   add GitHub" work without a detour.
3. **Nothing matches.** An account is created, subject to exactly the gate
   `/auth/register` applies — on an `OPEN_REGISTRATION=false` instance there has
   to be a live invitation for **the provider's address**, and arriving through
   Google does not get round it. If you came in through an invitation link, it
   is accepted on the way, the same as filling in the sign-up form would.

An invitation only ever admits the address it was sent to, and a provider
reports whichever address that account uses. So an invitation sent to
`you@company.com` does not admit a Google account that reports `you@gmail.com`:
on a closed instance the sign-in is refused outright, and on an open one the
account is created but lands back on the invitation page, which says who it was
sent to and offers to sign out and use the other account.

An address that the provider has **not** verified never reaches an existing
account and never creates one either. In practice: Google must report
`email_verified`, and GitHub must list the address as verified under
`/user/emails` — a *public* address on a GitHub profile is not a verified one.

A deactivated account is refused however it signs in.

### Why a matching address is never enough on its own

Step 2 stops short of the obvious rule — "link any account whose address
matches" — and that is on purpose.

SoftTrack has never confirmed that whoever typed an address at `/auth/register`
can read mail sent to it. There is no verification email anywhere; the only
mail SoftTrack sends is the [notification digest](notifications.md). So a row
carrying an address is a *claim*, not a fact. Somebody could register
`you@company.com` before you ever visit, keep the password, and wait. If a
verified Google identity were then joined to that row on the address alone, you
would sign in, see a perfectly normal account, and work inside one they still
hold the key to. That is account pre-hijacking.

"Has no password" does not rescue the rule either, which is the subtle half.
It is true at the moment an account is created — only a provider sign-in makes
a password-less account — but such an account can then **rename itself** to any
free address, with nothing to confirm against, because there is no password to
ask for. So the same attack works one step along: sign in with GitHub as
yourself, rename the account to `you@company.com`, and wait.

So the evidence has to be something a *provider* wrote: an existing connected
account on that row already reporting the same address. Nothing else counts,
and `User.email` never does.

Two refusals come out of this, worded differently because the way through
differs:

- **The account has a password.** *"Sign in with your password, then connect
  the provider from Settings → Security."* If it is yours, that is one extra
  step, once.
- **It does not, and no provider vouches for that address** — a renamed
  account, or a **reassigned** one (a Google Workspace seat given to a new
  colleague arrives with the same address and a different id). *"Sign in the
  way it was set up, then connect this from Settings → Security."*

## Connecting a provider to an account you already have

From **Settings → Security → Connected accounts**, *Connect* asks the API for a
short-lived ticket naming the account you are signed into, carries that out to
the provider, and posts the result back with your session when it returns.
Nothing is written until that last step, so the ticket travelling in the URL
cannot attach anything to anyone by itself. The session is the proof, so:

- it attaches to *your* account, never to whichever one the provider's address
  happens to match;
- the two addresses do not have to be the same, which matters if your SoftTrack
  address is `you@company.com` and your GitHub is `you@gmail.com`;
- connecting cannot sign you into a different account or create a third one,
  which is exactly what running the ordinary sign-in flow from that button
  would have risked.

One account per provider: *Use another* on a connected row replaces it rather
than adding a second, so *Disconnect* is never ambiguous about which key it
removed — and replacing does not require disconnecting first, which matters for
an account whose only way in is the provider it wants to change. A provider
account already attached to somebody else's SoftTrack account is refused.

*Disconnect* removes that provider's key to your account immediately.

## Accounts with no password

An account created by signing in with a provider has no password at all, rather
than a random one nobody knows. The Security page says so and offers to set
one; doing that adds email and password as a second way in, which matters if
the operator ever switches the provider off.

Until then, two things behave slightly differently for such an account, both
for the same reason — there is nothing to confirm against:

- Changing your email address does not ask for a password. The session is
  already authenticated, and anyone holding it could set a password first and
  then pass the check anyway.
- Disconnecting your **last** connected account is refused. The screen after
  that would be a sign-in form you cannot satisfy, and recovering needs a site
  administrator.

A site administrator can still set a password for somebody locked out, from
**Settings → Administration → Users**, exactly as for any other account.

## Limits

- Two providers, and no way to add a third from configuration. Each is a
  different set of quirks rather than a row of settings — GitHub does not hand
  back an address with the profile and has to be asked separately — and a
  generic "OIDC provider" field would be a lie about both.
- Enterprise **SAML and OIDC** are a separate, later piece of work. See the
  [roadmap](../roadmap.md).
- Starting a sign-in is throttled per address, like every other credential path
  here. See [sign-in rate limiting](rate-limiting.md).

# Personal API tokens

Scripts and integrations authenticate with a personal API token instead of
signing in as a browser does. Make one under **Settings → Security → API
tokens**, and send it the way a session token is sent:

```bash
curl -H "Authorization: Bearer softtrack_…" https://your-instance/auth/me
```

- **A token acts as its owner**, with its owner's permissions. There are no
  scopes yet.
- **The secret is shown once**, just after the token is made. SoftTrack keeps
  only a SHA-256 hash of it, and the list shows a hint (`softtrack_…Xy3Q`) so
  you can tell tokens apart.
- **Tokens start with `softtrack_`**, so a leaked one is easy to spot, whether
  by a secret scanner or by someone reading a log. SoftTrack never logs the
  secret.
- **Revoking is immediate.** The token is looked up on every request and
  nothing caches it, so it stops working on the next request.
- **Expiry is optional:** 30 days, 90 days, a year, or never.
- **Last used** is recorded to the minute, which shows which tokens are idle.

Some things a token deliberately can't do:

- **Manage tokens, or change the password.** Those need a signed-in session. A
  token that could make another token would survive its own revocation, and
  one that could set the password could take over the account.
- **Outlive its account.** Deactivating an account deletes its tokens. They
  don't come back if the account is reactivated.
- **Be guessed at leisure.** Failed token requests are throttled per address,
  the same way failed sign-ins are. A valid token is never slowed down.

"Sign out everywhere" ends sessions, not tokens. A script isn't a session;
revoke its token to stop it.

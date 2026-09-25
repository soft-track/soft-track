# User management

### The first account is the site administrator

Whoever registers first on a fresh instance gets `is_site_admin`. There is
nobody to grant it otherwise, and an instance with no administrator has no way
to ever get one. Upgrading an existing install promotes the oldest account for
the same reason. From **Settings → Administration → Users** a site admin can
search the directory, deactivate and reactivate accounts, hand the privilege to
somebody else, and set a password for a colleague who is locked out.

Two guards you will meet rather than read about: nobody can deactivate or
demote *themselves*, and the last active site administrator cannot be switched
off by anyone. Both exist because the failure is unrecoverable without database
access.

An account can also be created by [signing in with Google or GitHub](oauth.md),
and such an account has no password until somebody sets one from **Settings →
Security**. The first-account rule does not care which way the first person
arrived. An account that *does* have a password is never joined to a provider
automatically — its owner connects one from Settings, where being signed in is
the proof. The reasoning is worth reading before changing it.

### Team roles

Every membership is `admin` or `member`. Admins rename the team, invite people,
change roles, and remove members; members do everything else. Anyone can leave
a team on their own. A team always keeps at least one **active** admin —
"active" matters, because a team whose other admin was deactivated months ago
would otherwise be one departure away from having nobody who can add anyone.

A team's **key** cannot be changed. `ENG-42` is already in commit messages,
chat logs and browser history by the time anyone wants to rename it.

### Invitations, without a mail server

SoftTrack does not send invitations by email — the only mail it sends is the
[notification digest](notifications.md), and that is off unless SMTP is
configured. An invitation is a row and a link: a team admin
invites an address from **Settings → *Team* → Members**, and copies the link
into whatever the team already uses. That works whether or not the person has an
account — `/invite/<token>` shows who invited them, to which team, and as
what, and offers to sign in or register from there.

- One live invitation per address per team. Re-inviting the same address mints
a fresh token and retires the old link, which is what "resend" does.
- Accepting checks the signed-in user's address against the invitation's, so a
  forwarded link admits nobody it was not sent to.
- Accept, decline and revoke all delete the row. The membership and its
  `joined_at` are the record worth keeping.
- Links expire after `INVITE_EXPIRE_DAYS` (7 by default).

### Invite-only instances

Set `OPEN_REGISTRATION=false` and `/auth/register` only accepts a registration
whose email already has a live invitation waiting. The sign-up page says so
rather than failing on submit. The first-account rule is unchanged, so bring an
instance up, register yourself, then close it.

### Deactivate, not delete

Accounts are never deleted. Issues, comments and history all carry foreign keys
to users, so removing the row would either take that work with it or leave the
tracker unable to say who did what. Deactivating an account signs it out
immediately, refuses its next sign-in, and keeps it out of assignee pickers —
while its issues stay assigned and its comments stay attributed. Reactivating
undoes all of it.

"Immediately" is worth a sentence, because tokens live for a week. Every user
row carries a `token_version` that is copied into their JWTs and checked on
each request; deactivating, changing a password, resetting one, or using
**Sign out everywhere** bumps it, and every token issued before that stops
working. Tokens minted before this feature carry no version and are read as
`0`, which matches every existing row — so upgrading signs nobody out.

### Forgot password

With SMTP configured, the sign-in page offers **Forgot password?**. It emails
a link to choose a new password, which works once and expires after an hour
(`PASSWORD_RESET_EXPIRE_MINUTES`). Without SMTP the link isn't shown, and a
site administrator resets passwords from the admin page as before.

Most of the design is about what the flow must not reveal or allow:

- **It never says whether an address has an account.** The answer is the same
  `204` either way. The email is sent after the response, so the time an SMTP
  round trip takes can't be measured to tell the cases apart. Requests are
  throttled per client address and per address typed, and the second limit
  also stops the form being used to flood somebody's inbox. Because both are
  keyed on what was typed, a `429` doesn't reveal anything either.
- **Only a SHA-256 hash of the token is stored.** A leaked backup doesn't
  contain working links.
- **One link at a time.** Asking again replaces the previous link, and any
  failed use spends it.
- **A link dies when the password changes by any other route, or when the
  account signs out everywhere.** Each link records the account's token
  version, so an old email can't undo the owner's later change.
- **Using a link signs out every session**, the same as changing a password,
  and the next step is signing in with the new one.
- The reset page removes the token from the address bar as soon as it has read
  it, so the token doesn't linger in browser history or leak through `Referer`
  headers.

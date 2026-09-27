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

### Job title, location and start date

A profile can say what somebody does here, where they work from, and when
they started. All three are optional, and an instance that never fills them in
looks exactly as it did before they existed. Who sets which is deliberate:

- **Job title and location are the person's own.** They edit them in
  **Settings → Profile**, beside their name. Both are free text, trimmed, and
  cleared by emptying the field. A site admin sees them in the user directory
  but can't change them.
- **The start date belongs to the organisation.** A site admin sets it from
  **Administration → Users** with **Edit** on the person's row. The person
  sees it read-only under their profile, in *Your place in the organisation*,
  with a line saying to ask a site admin if it's wrong.

The start date is a date, not a timestamp, like a ticket's due date: a start is
a day, and a timestamp would move it across midnight for anyone in another
timezone.

### Departments

A department is a row, not free text. A department typed by hand ends up
spelled four ways, and anything that filters by it would have to guess. A
site admin keeps the list in **Administration → Departments** and puts people
in them from **Users**, next to the start date. People see their own
department under their profile but can't change it. Anyone signed in can read
the list: a department's name is no secret from the people who work in it.

- **Names are unique whatever the case.** "engineering" can't join
  "Engineering", and the refusal names the one that exists. The table stores
  the name case-folded (`name_key`) under a unique constraint. That works the
  same on SQLite and Postgres and folds more than ASCII, so "équipe" and
  "Équipe" clash too.
- **Renaming follows everyone in it**, because people point at the row rather
  than at its name.
- **Deleting one with people in it asks where they go**: another department,
  or none. Delete stays disabled until the admin chooses, the same shape as
  deleting a status. On the API, `DELETE /departments/{id}` takes
  `{"move_to_id": …}` (an id, or `null` for none), and leaving it out is a
  `409 department_not_empty`. Deactivated accounts count, since they point at
  the row too. A department with nobody in it deletes with a plain confirm.

The list is flat on purpose: no parent departments, no heads, no permissions.
Those are org-chart features that can come later if they earn it.

### Managers

Each person can have one manager: who they report to, and who to ask when
their work is stuck. A site admin sets it from **Users**, with **Edit** on
the row, by typing part of a name. People see their manager under their
profile, and the directory row says `reports to …` and `N direct reports`.

- **A loop is refused, with a sentence.** "Amina Khan can’t report to Daniel
  Okafor: Daniel Okafor already reports to Amina Khan." The server walks the
  chain upward from the new manager when the link is set, which also catches a
  loop through other people ("already reports up to"). Nobody is their own
  manager.
- **Deactivating a manager leaves the links in place.** The people reporting to
  them are not silently orphaned. Instead the user directory shows a banner,
  "3 people report to a deactivated manager (Jonas Berg)", and **Show them**
  lists them, each with Edit to choose someone new. On the API that list is
  `GET /admin/users?reports_to_deactivated=true`. Nobody *new* can report to a
  deactivated account, but saving someone's other details keeps the manager
  they already have.
- **It is information, not authority.** No approvals, no "managers can edit
  their reports' tickets", no permissions derived from the chain. Roles stay
  team admin, member and guest, plus the site admin.

### Team roles

Every membership is `admin`, `member` or `guest`. Admins rename the team,
invite people, change roles, and remove members; members do everything else.
Anyone can leave a team on their own. A team always keeps at least one **active** admin —
"active" matters, because a team whose other admin was deactivated months ago
would otherwise be one departure away from having nobody who can add anyone.

A team's **key** cannot be changed. `ENG-42` is already in commit messages,
chat logs and browser history by the time anyone wants to rename it.

### Guests

A guest sees what a member sees -- the board, the list, every ticket and its
comments, sprints, reports and search -- and changes none of it: no tickets, no
comments, no settings. It is the role for a stakeholder, a client, or a
neighbouring team that needs visibility without write access, and it is the
part of "granular permissions" that covers most of the need without committing
to a permission model.

What a guest *does* write is their own relationship to the team: watching an
ticket (so they are notified like anyone else), choosing their own default view,
and leaving. Admins make someone a guest from the invitation form or by
changing an existing member's role.

The boundary is on the server, in one place. Every route that changes
something inside a team declares `team_writer` (`backend/app_softtrack/guards.py`),
which works out the team from the URL and refuses a guest before the request
body is even read. `backend/tests/test_guest_role.py` sends every POST, PUT,
PATCH and DELETE in the OpenAPI schema as a guest and expects a 403 with the
code `team_read_only`, so a new route that forgets the guard fails the suite
the day it is written. A route a guest is *meant* to reach is listed there
with the reason. The browser hides the controls a guest cannot use -- the New
ticket button, dragging cards, the comment box -- but that is only so it does
not offer what would fail.

Linking tickets across teams needs write access to both, because the link shows
on both tickets.

### Invitations, with or without a mail server

An invitation is a row and a link. A team admin invites an address from
**Settings → *Team* → Members** and copies the link into whatever the team
already uses. With SMTP configured, the invitation can also be emailed. That
option is ticked by default, and the email says who invited them, to which
team and role, and when the link expires. Emailing is purely an addition:
the link can always be copied, and an instance without SMTP sees nothing
new. Pending invitations that were emailed say "Sent to …" with the time the
email was *attempted*. SMTP accepting a message is all SoftTrack can know
about its delivery. That works whether or not the person has an
account — `/invite/<token>` shows who invited them, to which team, and as
what, and offers to sign in or register from there.

- One live invitation per address per team. Re-inviting the same address mints
a fresh token and retires the old link, which is what "resend" does. Resend
repeats the original delivery: it emails again if the invitation was emailed.
A resend that isn't emailed clears "Sent to", because the emailed link has
just stopped working.
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

Accounts are never deleted. Tickets, comments and history all carry foreign keys
to users, so removing the row would either take that work with it or leave the
tracker unable to say who did what. Deactivating an account signs it out
immediately, refuses its next sign-in, and keeps it out of assignee pickers —
while its tickets stay assigned and its comments stay attributed. Reactivating
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

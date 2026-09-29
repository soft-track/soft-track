# Payroll and finance

People taught SoftTrack who works here. Finance adds what the organisation owes
them and spends on them. The pieces land one at a time (#130–#137, under the
epic #136), and this page grows with them.

Two lines hold everywhere:

- **Money is visible to almost nobody.** That is the inverse of the people
  directory, which anyone signed in can read. Every finance endpoint checks one
  flag, and finance data lives in its own response schemas. A profile, a
  directory row or an admin row never carries it.
- **SoftTrack is the system of record, not the payment rail.** It computes no
  tax, models no withholding, talks to no bank and files nothing. What it
  produces ends in a CSV for whatever actually moves money and knows your
  jurisdiction's rules.

## Who can see money

A **finance admin** can. Nobody else can, and that includes the site admin.
The site admin is the IT role: resetting somebody's password says nothing
about reading their salary. The flag is `is_finance_admin` on the account,
separate from `is_site_admin`, and neither includes the other.

- **A site admin grants and revokes it** from **Administration → Users**, with
  **Grant finance access** on the person's row. Granting asks first and says
  what it gives: every salary, payroll run, expense claim and budget, and
  approving them. Revoking takes effect at once and doesn't ask. The row shows
  a **Finance** chip, and when and by whom the access was granted. **Finance
  admins**, beside **Site admins**, filters the directory down to them. On the
  API this is `PATCH /admin/users/{id}` with `{"is_finance_admin": true}` and
  `GET /admin/users?role=finance_admin`.
- **A site admin may grant it to themselves.** Refusing would protect nothing,
  since they could grant it to anybody.
- **There is no last-finance-admin rule.** If the last one leaves, a site admin
  grants the flag again. The last-site-admin rule exists only because nobody
  would be left to do the granting.
- **Deactivating an account revokes it**, the way it deletes the account's API
  tokens. Reactivating somebody doesn't quietly bring money access back with
  them. It is granted again on purpose.
- **Every grant and revoke is logged**, with who, whom and when:

  ```text
  INFO:     finance_admin.granted at=2026-09-27T10:14:03Z by=sofia user=mei
  INFO:     finance_admin.revoked at=2026-09-27T10:21:48Z by=sofia user=omar
  ```

  The line goes to uvicorn's own logger, so it appears in `docker compose logs
  backend` with the rest of the server's output.

One flag, all or nothing: no view, edit and approve split, and no scoping by
department. The granular version can earn its place later, the same way team
roles stayed two until guests needed a third.

### The guard

Every route under `/finance` sits on a router made by `finance_router()` in
`backend/lib_finance/access.py`. The router puts `require_finance_admin` in
front of all of its routes at once, so a route added later is guarded whether
or not its author remembered. `backend/tests/test_finance_access.py` walks
every route under `/finance` and fails if one is missing the check. Without
the flag, the API answers `403` with the code `not_finance_admin`.

In the app, a finance page opened without the flag doesn't redirect. It says
*Finance is for finance admins* and who can grant access, because a finance
URL is one a finance admin pastes to somebody. A site admin sees where to
grant it.

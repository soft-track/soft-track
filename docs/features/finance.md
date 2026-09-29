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

## Compensation

What somebody is paid is a history, not a column. A salary is a series of
decisions: hired at this, raised to that in March. A column loses the series the
first time it is updated, and with it the answer to "what was this person paid
in Q1". Payroll runs and finance reports ask exactly that question.

**Finance → Compensation** lists everybody active with what they are paid
today: the amount, the pay schedule, since when, and the last change ("Raise,
+4%", "Hired", "Correction"). A person's name opens their history, where every
record is a row. **Record pay** adds one.

- **A record is gross agreed pay for one pay period** (a month, half a month
  or two weeks, per its schedule), in the currency it was agreed in, from an
  effective date. It also has a kind (hire, raise, correction, other), an
  optional note, and who recorded it.
- **Amounts are integers in the currency's minor unit.** 8,300.00 USD is stored
  as `830000`. Floating point and money is a bug that pays somebody a tenth of a
  cent forever. How many decimals each currency has comes from ISO 4217, via
  `GET /currencies`, so the browser keeps no copy of its own. An amount with
  more decimals than its currency has, like `1500.5` yen, is refused rather
  than rounded.
- **Records are append-only.** A raise is a new record. A correction is a new
  record that names the one it corrects. Nothing is edited or deleted, and the
  API has no route that could. A record is corrected once; to fix a correction,
  correct the correction.
- **What somebody is paid on a day is worked out, never stored.** Records that a
  correction replaced are left out, as if never recorded. Of the rest, the
  latest effective on or before that day wins, and on a tie the one recorded
  last. A record dated ahead is *scheduled* until its day. A correction can
  move the date as well as the amount.
- **Nobody is quietly left out.** Somebody with nothing in effect is listed
  last, marked *Nothing recorded*, and counted. A new starter whose first
  record is still ahead says when they start.
- **Totals are per currency and per schedule.** Current pay adds up as
  "EUR €24,700.00 monthly · USD $3,100.00 semi-monthly". Nothing is converted
  and nothing is annualised: there is no rate to add euros to pounds, or a
  month to a fortnight. The totals cover everybody the filters match, not just
  the page shown.

There are no deductions, no withholding, and no bonus or equity. Gross agreed
pay is the record. What leaves it before it reaches a bank is the payroll
bureau's business.

On the API, all finance-admin only:

- `GET /finance/compensation` lists everybody active. It takes `q`,
  `department_id`, `currency`, `limit` and `offset`, and returns `totals` and
  `missing` with the rows.
- `GET /finance/compensation/{username}` returns one person's history. Each
  record is marked `scheduled`, `current`, `past` or `corrected`.
- `POST /finance/compensation/{username}` records pay. A correction carries
  `corrects_id`. Correcting a record twice is `409
  compensation_already_corrected`, and naming somebody else's record is `404
  compensation_not_found`.

Every finance response uses its own schemas (`backend/lib_finance/models/`).
`tests/test_finance_access.py` follows every response outside `/finance`
through every schema it points to, and fails if any of them is a finance
schema. The one exception is the currency list.

## Payroll runs

A payroll run is a pay period made concrete: these people, these amounts,
reviewed by a person, approved, and handed to whatever actually moves the money.
SoftTrack keeps the record and the export. It computes no tax, models no
withholding, files nothing and pays nobody.

**Finance → Payroll runs** lists every run, newest period first, with its state
and its totals per currency. **New run** generates a draft for one period on one
pay schedule. The dates start as the period after that schedule's latest run,
and they stay editable for payroll that runs from the 26th.

- **One period, one schedule.** A monthly run and a semi-monthly run for
  September are two runs, because a period's lines only make sense for the
  people paid on that schedule. Runs on the same schedule never cover the same
  day twice (`409 payroll_run_overlaps`), so nobody is paid twice for it.
- **A draft follows compensation as it changes.** Its lines are worked out
  whenever it is read. That means everybody active whose pay in effect on the
  period's last day is on this schedule, plus everybody active with no pay in
  effect at all. Pay recorded, or an account opened, after the run was
  generated is on it before it is approved. It is the pay on the last day, not
  a share of the month: a raise halfway through is an adjustment somebody
  decides, not a proration SoftTrack guesses.
- **Missing, not skipped.** People with no compensation are on the run as
  lines, at the bottom, named in a callout. **Record pay** on the line records
  it there and then. Approving warns who the run will not pay.
- **A line takes a one-off adjustment** in its own currency, positive or
  negative, and always with a reason ("+$400.00 On-call, 4 weekends"). An
  adjustment can't take a line below zero. Somebody who leaves the run before
  approval, deactivated or moved to another schedule, takes their adjustment
  with them.
- **Approval freezes the run.** Every line is written with its amount, currency
  and compensation record copied onto it, and with the department the person
  was in. A raise recorded next week can't change what an approved run says
  was paid, and a reorg can't move its cost to another department. A department
  that payroll has been approved under can be renamed but not deleted
  (`409 department_has_finance_history`), so that history keeps pointing somewhere.
- **State is set, not derived:** draft → approved → paid, forward only, each
  step by a finance admin. A mistake found after approval is put right on the
  next run, which is how payroll corrections are made anyway. A draft can be
  thrown away. An approved run is a record and stays.
- **The export is the product.** Only an approved run has a CSV. It has
  `name, amount, currency, period_start, period_end`, with the adjustment
  included in the amount and missing lines left out, shaped for a bank
  template or a payroll bureau. It follows the same rules as the ticket export:
  a UTF-8 BOM, and names a spreadsheet would run as a formula made plain.

On the API, all under `/finance/payroll/runs`:

| | |
| --- | --- |
| `GET /`, `POST /` | List runs; generate a draft (`pay_schedule`, `period_start`, `period_end`) |
| `GET /{id}`, `DELETE /{id}` | One run and its lines; throw away a draft |
| `PUT /{id}/lines/{user_id}/adjustment` | `{"amount_minor": 40000, "note": "…"}`, and `DELETE` to take it off |
| `POST /{id}/approve`, `POST /{id}/paid` | Move it on |
| `GET /{id}/export` | The CSV, once approved |

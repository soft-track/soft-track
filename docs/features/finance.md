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

## Expense claims

Expenses are the one finance feature everybody touches: buy the thing, keep the
receipt, get paid back. There are two sides to it, and a wall between them.

**Settings → Expenses** is everybody's own, finance access or not. **New
expense** takes an amount and currency, the date the money was spent, a
description, and a receipt. The list shows each of your claims and where it
stands. A claim that is still waiting can be edited or withdrawn. A decided
claim says who decided it, and a refusal says why. Only you and finance admins
see your claims, because an expense says where you were and what you bought.
The API has no way to ask for anybody else's: `/expenses` only ever answers
with the caller's own claims, and somebody else's claim id is a 404 there.

**Finance → Expense claims** is the review queue: every claim, filtered by state
(with a count on each) and by person. A chosen claim shows beside the list with
its receipt, a photo inline or a PDF in the browser's own viewer. It is
**Approve** or **Refuse…**.

- **Approval belongs to finance**, not the manager chain, which stays
  information. Nobody decides their own claim, finance access or not
  (`409 expense_own_claim`). Another finance admin does.
- **A refusal needs a reason**, and the submitter sees it on the claim. "No"
  with no why is a Slack thread waiting to happen.
- **A decided claim is frozen** (`409 expense_decided`). A correction is a new
  claim, the same instinct as compensation's append-only history. Approval
  copies the submitter's department onto the claim, like a payroll line, so a
  reorg can't move what a department spent.
- **A claim is for money already spent.** A date more than a day ahead is
  refused (`400 expense_in_future`); the day of slack is for somebody a
  timezone ahead of the server.
- **Receipts ride the attachment pipeline**: the same name handling, types
  derived from the name and never taken from the request, byte checks that a
  PNG is a PNG and a PDF a PDF, the same storage (local or S3), and the same
  headers on the way out. A receipt must be an image or a PDF, since a receipt
  is not a zip file. It lives on the claim rather than as an attachment row,
  because attachments belong to tickets and are guarded by the ticket's team,
  while a receipt is guarded by who may see money. Replacing a receipt or
  withdrawing a claim removes the old bytes.

There is no policy engine: no per-diem rules, category limits or approval
chains. One submitter, one decision, one paper trail. What happens to an
approved claim next is [reimbursement](#reimbursements).

On the API:

| | |
| --- | --- |
| `GET /expenses`, `POST /expenses` | Your claims; submit one |
| `PATCH /expenses/{id}`, `DELETE /expenses/{id}` | Change or withdraw one while it waits |
| `PUT /expenses/{id}/receipt`, `DELETE …`, `GET …` | Attach, remove or fetch its receipt |
| `GET /finance/expenses?state=&submitter_id=` | Every claim, with `counts` per state |
| `GET /finance/expenses/{id}`, `…/receipt` | One claim, and its receipt |
| `POST /finance/expenses/{id}/approve` | Approve |
| `POST /finance/expenses/{id}/refuse` | `{"reason": "…"}`, required |

## Reimbursements

An approved expense is a debt: the company agrees it owes the money.
Reimbursement is the debt settled. The gap between the two is where trust
erodes, in claims that sit "approved" for six weeks with nobody able to say
when the money moves.

**Finance → Reimbursements** lists every approved claim not paid back yet, the
longest waiting first. Tick some, see what they come to per currency, and pay
them back one of two ways:

- **New batch** gathers them into a batch of their own, **RB-8**. A batch works
  like a payroll run: draft → approved → paid, each step by a finance admin.
  Its CSV has one row per person per currency, in the payroll export's columns,
  with the days the claims were spent as the period and `reimbursement` as the
  kind. Take a claim back out of a draft with **Take out**; taking out the last
  one throws the draft away.
- **Carry on a payroll run** puts them on a draft run, the next one by default.
  Each person's claims become a reimbursement line of their own under their
  pay, in the run and in its CSV. They are never merged into the wages, because
  whoever reads the export needs to know which part is pay. The payroll CSV
  gains a `kind` column (`wages` or `reimbursement`) for this. A run carries
  claims only for people it pays (`409 reimbursement_not_on_run`). Throwing the
  draft run away sends its claims back to awaiting.

**A claim is paid back exactly once.** Each claim records the batch or run it
goes out on, and the row itself allows only one: a check constraint refuses a
claim in a batch *and* on a run, and another refuses either for a claim that
isn't approved. Paying a claim twice is impossible to record, not merely
discouraged. The service says so first: gathering a claim that is already going
out is `409 expense_already_settled`, naming where it is. A claim in an
approved batch or run stays there (`409 expense_settlement_locked`).

**The submitter sees the money move.** Marking the batch or run paid stamps
every claim in it. **Settings → Expenses** turns "Approved · awaiting
reimbursement, in batch RB-8, not paid yet" into "Reimbursed on 16 Sep 2026, in
batch RB-6, paid by Grace Mensah", or "with the August 2026 payroll run".

There are no partial reimbursements. A claim paid in part is a decision that
deserves a paper trail, which means a refusal and a corrected claim, not a
remainder column.

On the API, all under `/finance/reimbursements`:

| | |
| --- | --- |
| `GET /awaiting` | Approved claims not paid back, each with its `settlement` if it has one |
| `POST /batches`, `GET /batches` | Gather `{"expense_ids": […]}` into a draft; list batches |
| `GET`, `DELETE /batches/{id}` | One batch with its lines and claims; throw a draft away |
| `POST /batches/{id}/approve`, `…/paid` | Move it on |
| `GET /batches/{id}/export` | The CSV, once approved |
| `POST /carry` | `{"run_id": …, "expense_ids": […]}` onto a draft run |
| `DELETE /expenses/{id}/settlement` | Take a claim back out of a draft batch or run |

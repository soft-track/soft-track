# Time tracking

Log the time you spent on a ticket from its panel: **Time → Log time**, then
something like `2h 30m`, `45m`, `1.5h` or `2:30`, the day, and an optional
note. The panel shows the total, who spent it, and every entry; you can edit
or delete your own. Board cards show none of it — cards stay clean.

Reports gets two charts: time logged **in the chosen sprint**, and time logged
on the team's tickets **over the chosen window**, one bar per person.

Deliberately Jira-lite: no timers, no billing rates, no approvals.

## Decisions worth knowing

- **Minutes, as an integer.** Every question asked of time is a sum, and
  integers sum exactly and identically on SQLite and Postgres.
- **One entry is one day's work**, so each has a date and is at most 24
  hours. "2h yesterday, 3h today" is two entries, and a report by day is a
  grouping rather than a guess about how to spread a three-day entry.
- **The date defaults to today — your today.** The browser sends its own
  date, so an entry made at 11pm in Sydney lands on the right day. Dates in
  the future are refused, with a day's slack for time zones ahead of UTC.
- **Only whoever logged an entry can change or delete it**, admins included.
  Time is a claim somebody made about their own day.
- **A sprint's time is what was logged during the sprint on tickets that were
  ever in it.** Time spent before a ticket was carried over to the next sprint
  stays with this one; counting the tickets currently in the sprint instead
  would move a finished sprint's hours whenever someone tidied the backlog.
- Time belongs to the ticket: it moves with it to another team, waits with it
  in the [trash](trash.md), and goes when the ticket is purged. Guests see it
  and cannot log it.

## Time estimates

A ticket's points say how big it is; a **time estimate** says what it was
meant to cost. A team chooses in **Settings → General → Estimates**: points
(the default — a team that leaves it sees no change), hours, or both. The
ticket panel offers whichever the team estimates in, beside each other for
both; a ticket that already has the other kind keeps showing it.

- **Remaining** is the time estimate less what is logged, never below zero,
  until somebody says otherwise. Logging time asks *How much is left?* with
  that answer worked out; leaving it alone keeps it worked out, changing it
  sets remaining by hand, and from then on each entry logged takes its time
  off what was said. A ticket that is done or cancelled has nothing left.
- The **Time** section shows logged against estimated as a bar, with what is
  left. Over is said in words — *over by 4h* — not by colour alone. A parent's
  bar includes its sub-tickets.
- A team that estimates in hours sees a **sprint's** and an **epic's**
  estimated, logged and remaining time, with the tickets that are over listed
  under it. A sub-ticket with no sprint or epic of its own counts in its
  parent's.
- The **burndown** can be drawn in remaining hours (Reports → Hours, for a
  team that estimates in both).
- The CSV export has `time_estimate_hours`, `time_logged_hours` and
  `time_remaining_hours`, as decimal hours a spreadsheet sums.
- **Has no estimate** asks about what the team estimates in: points, a time
  estimate, or — for both — either.

There is no conversion between points and hours: they answer different
questions. Estimates are minutes, like time logged, so the two subtract
exactly, and the sums group by any column on a ticket
(`lib_softtrack/time_estimates.totals_by`) — a person, a sprint, a week.

## API

- `GET /tickets/{ticket_id}/worklogs` — the total, per person, and every entry.
- `POST /tickets/{ticket_id}/worklogs` — `{minutes, worked_on?, note?, remaining_minutes?}`;
  `remaining_minutes` sets what is left, and `null` hands it back to the sum.
- `PATCH /worklogs/{worklog_id}`, `DELETE /worklogs/{worklog_id}` — your own only.
- `GET /sprints/{sprint_id}/time-spent`, `GET /teams/{team_id}/time-spent?days=30`.
- `PATCH /tickets/{ticket_id}` — `time_estimate_minutes` and `remaining_minutes`.
- `GET /tickets/{ticket_id}/time-estimate` — estimated, logged and remaining,
  on its own and with its sub-tickets.
- `GET /sprints/{sprint_id}/time`, `GET /projects/{project_id}/time` —
  estimated, logged and remaining, and the tickets that are over.

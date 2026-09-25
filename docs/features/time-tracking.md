# Time tracking

Log the time you spent on an issue from its panel: **Time → Log time**, then
something like `2h 30m`, `45m`, `1.5h` or `2:30`, the day, and an optional
note. The panel shows the total, who spent it, and every entry; you can edit
or delete your own. Board cards show none of it — cards stay clean.

Reports gets two charts: time logged **in the chosen cycle**, and time logged
on the team's issues **over the chosen window**, one bar per person.

Deliberately Jira-lite: no remaining-estimate burndown (SoftTrack's burndown
is scope-based), no timers, no billing rates, no approvals.

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
- **A cycle's time is what was logged during the cycle on issues that were
  ever in it.** Time spent before an issue was carried over to the next cycle
  stays with this one; counting the issues currently in the cycle instead
  would move a finished sprint's hours whenever someone tidied the backlog.
- Time belongs to the issue: it moves with it to another team, and goes when
  the issue is deleted. Guests see it and cannot log it.

## API

- `GET /issues/{issue_id}/worklogs` — the total, per person, and every entry.
- `POST /issues/{issue_id}/worklogs` — `{minutes, worked_on?, note?}`.
- `PATCH /worklogs/{worklog_id}`, `DELETE /worklogs/{worklog_id}` — your own only.
- `GET /cycles/{cycle_id}/time-spent`, `GET /teams/{team_id}/time-spent?days=30`.

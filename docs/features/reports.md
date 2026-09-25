# Reports

Four charts, each answering a question about the past: how many points were
outstanding on the ninth, how much did the last six cycles deliver, is work
piling up in review, is the backlog growing.

No query over the current rows can answer any of those. The `issueevent` table
is the only source — every change to an issue's status, cycle, estimate,
project, assignee or priority writes a row — and each report replays those events up to the end of each day
and counts what the board looked like then. One replay serves all of them.

Three details that follow from that:

- **The burndown's ideal line runs from the cycle's *opening* scope to zero**,
  not from its current scope. Otherwise adding work mid-cycle would quietly
  move the goalposts and the line would always look on track. Scope changes are
  reported separately, as the events they are.
- **Velocity's "committed" is the scope at the moment the cycle started.** A
  team that finished everything it added late did not commit to it.
- **Charts never run into the future.** A burndown flat to the end of the
  sprint reads as "nothing is happening" rather than "this has not happened
  yet", so an active cycle's line stops today.

Reports begin from the day history started being kept. An issue with no event
at or before a given day is left out of that day entirely rather than counted
in `backlog` — that would draw work which had not been created — and the
reports page carries a line saying earlier activity cannot be reconstructed,
because a chart that quietly starts late looks like a chart of a quiet week.

## The same history, on the issue

The issue panel's **Activity** section shows the issue's history among its
comments, oldest first. Each change is one quiet line: who made it, what it
was, and when, for example "Maya moved this from Started to Done · 2 hours
ago". Changes made by an automation rule are credited to "Automation".

- The values an issue was created with are its starting point, not changes.
  They're recorded (the charts need to know where an issue began) and marked
  `opening`, and the feed leaves them out.
- Statuses read as their category ("Started", "Done"), because that is what
  history records. Moving an issue between two columns in the same category
  doesn't write a row, so it doesn't appear.
- Assignee and priority changes are recorded too. No chart uses them; they're
  there because they're what people ask an issue's history about. Label
  changes aren't recorded.
- The panel shows the latest 100 changes, via `GET /issues/{id}/events`.

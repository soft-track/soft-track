# Epics

An epic groups the tickets that make up one larger piece of work. Epics,
sub-tickets and cycles group tickets three ways, and a fourth grouping that
overlapped them would be sprawl. The Jira importer maps `Epic Link` onto an
epic.

The API and the database still call an epic a *project* (`/projects`,
`project_id`), the name the interface used until #211.

An epic has a lead, a target date and a state (planned, in progress,
completed, cancelled), all set by hand. "Every ticket is done" is evidence that
an epic is finished, not a decision that it is. Archiving an epic takes it
out of the pickers without touching the tickets already in it, and deleting one
keeps its tickets and leaves them with no epic.

**Creating one.** The **+** beside Epics in the sidebar, or *Create an
epic* in the command palette, asks for a name, a colour, a lead and a
target date, and only the name is required. The colour starts on one no other
epic on the team is wearing, so two epics can be told apart on the
board without anyone choosing. The new epic opens on its own page, which
is where tickets get added. Guests are offered neither.

**Each epic has its own page**, opened from the arrow on its row in the
sidebar. The page shows the epic's fields, which you can edit there, and its
tickets grouped by the team's columns. Tickets can be added (found by search) and
removed without leaving the page. Removing a ticket only clears its epic;
the ticket itself stays.

**Progress is counted the way sub-ticket progress is.** "3 of 5 done" counts
tickets in a *done* column. A cancelled ticket is left out of both numbers,
because counting it as outstanding would make the total unreachable, and
counting it as done would claim work that never happened. Sub-tickets and
epics share one implementation of that rule, so they cannot drift apart.
Every epic in a list is counted in one grouped query, so a team with forty
epics costs the same to load as a team with one.

A ticket belongs to at most one epic. It gets into one:

- from the epic's page, with **Add tickets**
- by picking the epic when creating the ticket
- through the **Epic** field in the ticket's details
- through **Set epic** on a selection from the board

## The roadmap

The **Roadmap** tab lists the team's epics under the month their target
date falls in, with each epic's state, progress, lead and date. Every row
opens the epic's page. It answers the question the board and the cycles
view cannot: will this land by the date? An epic spans cycles by definition,
and both of those views only show work in flight now.

- **By month, not a zoomable timeline.** A target is a single day, and "what
  lands when" can be read straight off a list of months. A timeline would be a
  lot of code to maintain in exchange for a picture of the same thing. Months
  with nothing due are skipped rather than drawn empty.
- **Epics with no target date are listed last, under their own heading**,
  and the top of the page says how many there are. Leaving them off would make
  an unplanned epic look like one that doesn't exist.
- **Overdue** means past the target date and neither completed nor cancelled.
  Dates are compared as calendar days, so a target never moves across midnight
  for a reader in another timezone.
- Archived epics are left out, because they were retired from planning.

Left out on purpose: dragging epics to reschedule them, dependencies
between epics, and anything resembling resource planning.

## Grouping the board by epic

The **Group by** menu next to the view tabs arranges the board, and the list,
by epic instead of by status. On the board, each epic gets a column, and
dragging cards between columns moves them between epics. This works for a
whole selection too, as a single bulk edit. Tickets in no epic get a column
of their own, at the end. An archived epic only gets a column if it still
holds some of the tickets on screen. In the list, each epic gets a section.

Every card and list row shows its epic as a badge in the epic's colour.
When the board is grouped by epic, the badge is replaced by a status dot,
because the column heading already names the epic.

## Burnup

Each epic's page has a burnup chart: the epic's scope against its
completed work, day by day, in tickets or in points. It's a burnup rather than
a burndown because an epic's scope is expected to change. A rising scope line
is work added after work started, which explains most missed dates. A burndown
would fold that into "remaining" and hide it.

The chart is replayed from ticket history, like the [reports](reports.md), so
every change to a ticket's epic is recorded along with its status, cycle
and estimate changes. That includes tickets released when their epic is
deleted.

- **Cancelled tickets count as neither scope nor completed work**, the same
  rule as progress.
- **Unestimated tickets aren't counted as zero points.** They're counted
  separately. When any are in scope, the points view says so and marks the
  total as a floor (`8+ pts`). An unestimated ticket means "not sized yet",
  which is different from a small one.
- **The chart starts on the first day history records anything about the
  epic.** It isn't drawn back to the epic's creation, because nothing
  was recorded then. Upgrading to this release records every ticket already in
  an epic, stamped at the moment of the upgrade. That is true, and doesn't
  claim when the ticket joined. It means an existing epic's chart starts on
  upgrade day at its real scope.

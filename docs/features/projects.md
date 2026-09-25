# Projects (epics)

A project is what SoftTrack calls an epic. There is deliberately no separate
Epic entity: projects, sub-issues and cycles already group issues three ways,
and a fourth that overlapped them would be sprawl. The Jira importer maps
`Epic Link` onto a project for the same reason.

A project has a lead, a target date and a state (planned, in progress,
completed, cancelled), all set by hand. "Every issue is done" is evidence that
a project is finished, not a decision that it is. Archiving a project takes it
out of the pickers without touching the issues already in it, and deleting one
keeps its issues and leaves them with no project.

**Each project has its own page**, opened from the arrow on its row in the
sidebar. The page shows the project's fields, which you can edit there, and its
issues grouped by the team's columns. Issues can be added (found by search) and
removed without leaving the page. Removing an issue only clears its project;
the issue itself stays.

**Progress is counted the way sub-issue progress is.** "3 of 5 done" counts
issues in a *done* column. A cancelled issue is left out of both numbers,
because counting it as outstanding would make the total unreachable, and
counting it as done would claim work that never happened. Sub-issues and
projects share one implementation of that rule, so they cannot drift apart.
Every project in a list is counted in one grouped query, so a team with forty
projects costs the same to load as a team with one.

An issue belongs to at most one project. It gets into one:

- from the project's page, with **Add issues**
- by picking the project when creating the issue
- through the **Project** field in the issue's details
- through **Set project** on a selection from the board

## The roadmap

The **Roadmap** tab lists the team's projects under the month their target
date falls in, with each project's state, progress, lead and date. Every row
opens the project's page. It answers the question the board and the cycles
view cannot: will this land by the date? An epic spans cycles by definition,
and both of those views only show work in flight now.

- **By month, not a zoomable timeline.** A target is a single day, and "what
  lands when" can be read straight off a list of months. A timeline would be a
  lot of code to maintain in exchange for a picture of the same thing. Months
  with nothing due are skipped rather than drawn empty.
- **Projects with no target date are listed last, under their own heading**,
  and the top of the page says how many there are. Leaving them off would make
  an unplanned project look like one that doesn't exist.
- **Overdue** means past the target date and neither completed nor cancelled.
  Dates are compared as calendar days, so a target never moves across midnight
  for a reader in another timezone.
- Archived projects are left out, because they were retired from planning.

Left out on purpose: dragging projects to reschedule them, dependencies
between projects, and anything resembling resource planning.

## Grouping the board by project

The **Group by** menu next to the view tabs arranges the board, and the list,
by project instead of by status. On the board, each project gets a column, and
dragging cards between columns moves them between projects. This works for a
whole selection too, as a single bulk edit. Issues in no project get a column
of their own, at the end. An archived project only gets a column if it still
holds some of the issues on screen. In the list, each project gets a section.

Every card and list row shows its project as a badge in the project's colour.
When the board is grouped by project, the badge is replaced by a status dot,
because the column heading already names the project.

## Burnup

Each project's page has a burnup chart: the project's scope against its
completed work, day by day, in issues or in points. It's a burnup rather than
a burndown because an epic's scope is expected to change. A rising scope line
is work added after work started, which explains most missed dates. A burndown
would fold that into "remaining" and hide it.

The chart is replayed from issue history, like the [reports](reports.md), so
every change to an issue's project is recorded along with its status, cycle
and estimate changes. That includes issues released when their project is
deleted.

- **Cancelled issues count as neither scope nor completed work**, the same
  rule as progress.
- **Unestimated issues aren't counted as zero points.** They're counted
  separately. When any are in scope, the points view says so and marks the
  total as a floor (`8+ pts`). An unestimated issue means "not sized yet",
  which is different from a small one.
- **The chart starts on the first day history records anything about the
  project.** It isn't drawn back to the project's creation, because nothing
  was recorded then. Upgrading to this release records every issue already in
  a project, stamped at the moment of the upgrade. That is true, and doesn't
  claim when the issue joined. It means an existing project's chart starts on
  upgrade day at its real scope.

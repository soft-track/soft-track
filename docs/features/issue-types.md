# Issue types

Every issue is a **bug**, a **task** or a **story**, and a task unless someone
says otherwise. The type is shown as a small icon on every card and list row.
The three icons have different outlines (a bug, a square with a tick, a
bookmark), so they can be told apart without relying on colour, and each one
is also named in its tooltip and to screen readers.

- Set it in the new-issue form or the issue panel.
- Filter the board and list by it. The filter goes in links as `?type=bug` and
  saved views keep it.
- Automation rules can check it ("Type is") and change it ("Set type to"),
  wherever they can do the same with priority.
- The Jira importer maps Bug and Defect to bug, Story and User Story to story,
  and everything else (Task, Sub-task, Improvement, a team's own types) to
  task.

**The three types are fixed.** Per-team custom types are how Jira's type list
grew until nobody could say what "Sub-task (Technical)" meant.

**There is no epic type.** An epic is a [project](projects.md): it has a lead,
a target date, progress and a burnup. An epic type as well would give the
tracker two competing ways to say "these belong together". A Jira import turns
epic links into projects and imports the epic row itself as a task.

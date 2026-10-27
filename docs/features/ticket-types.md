# Ticket types

Every ticket is a **bug**, a **task** or a **story**, and a task unless someone
says otherwise. The type is shown as a small icon on every card and list row.
The three icons have different outlines (a bug, a square with a tick, a
bookmark), so they can be told apart without relying on colour, and each one
is also named in its tooltip and to screen readers.

- Set it in the new-ticket form or the ticket panel.
- Filter the board and list by it. The filter goes in links as `?type=bug` and
  saved views keep it.
- Automation rules can check it ("Type is") and change it ("Set type to"),
  wherever they can do the same with priority.
- A team's [custom fields](custom-fields.md) can be bound to types, so a
  Browser field shows on bugs and not on stories.
- The Jira importer maps Bug and Defect to bug, Story and User Story to story,
  and everything else (Task, Sub-task, Improvement, a team's own types) to
  task.

**The three types are fixed.** Per-team custom types are how Jira's type list
grew until nobody could say what "Sub-task (Technical)" meant.

**There is no epic type.** An [epic](projects.md) is not a kind of ticket but
a group of them, with a lead, a target date, progress and a burnup. An epic
type as well would give the tracker two competing ways to say "these belong
together". A Jira import turns epic links into epics and imports the epic row
itself as a task.

## Bug details

A bug has what a task does not (#273), built in rather than left to a team's
own fields because each comes with behaviour:

- **Severity**: critical, major, minor or trivial, and optional. It is not
  priority: priority says how soon, severity how bad, and a typo on the
  pricing page is trivial and urgent. Cards and list rows show it beside the
  priority, in words as well as colour.
- **Environment**: production, staging or development, or a name a team admin
  adds under **Settings → General → Environments**. A bug's environment is one
  of the team's (matched whatever the case, and stored as the team spells
  it); taking a name off the list leaves it on the bugs that have it.
- **Found in**: a [release](releases.md). Beside it, **Fixed in** is the bug's
  fix version, so "is this fixed in what the customer runs?" is two releases.
  A team with no releases is not asked either.
- **Steps to reproduce, expected and actual**: choosing Bug in the new-ticket
  form fills an empty description with the three as headings, and choosing
  another type takes them away again if nothing was written in them. They are
  headings in the markdown, not fields, so the description reads the same in
  an email, an export or anywhere else it is shown.

Only a bug is given them: setting one on another type of ticket is refused
(`400 bug_details_need_a_bug`), unless the same change makes it a bug.
**Changing a bug's type away keeps the values and hides them**, and changing it
back shows them again. While it is not a bug they are not shown, filtered,
grouped, sorted, counted or exported.

The board and the list **filter** by severity, environment and found in --
several of each, or every one but some -- and those filters ask about bugs
alone, either way round: "severity: not trivial" is the bugs that are not
trivial, not every task as well. "Critical bugs found in 1.3 on production"
is a filter now, and a saved view keeps it. They **group** by severity (worst
first) and by environment, and the list **sorts** by severity, with unrated
bugs and other tickets last whichever way round. Dropping a card on a
severity or environment column sets it.

**Reports** has **Open bugs, by severity**, beside created against resolved:
the bugs open at the end of each week, a line per severity, replayed from
history like the other charts. A bug is the ticket's type now -- types are
not in the history.

The **CSV export** has `bug_severity`, `bug_environment` and `found_in`
columns, empty on other tickets. They are named for bugs so that a team's own
Severity or Environment field, made before these were built in, keeps its
column. The **Jira import** reads Affects Version/s as found in and Fix
Version/s as the fix version (making a release of a version the team does
not have yet, and keeping the first where an issue names several), a Severity
field where a team added one, and Environment -- added to the team's list
when it is a name, and left out, with a warning, when it is a paragraph about
a browser.

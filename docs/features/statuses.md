# Statuses and categories

A team names its own board columns. Add "Blocked" or "QA", reorder them, rename
them, delete one — the board is a set of rows per team, not a fixed enum.

**Every status maps to one of five fixed categories**, and that is what makes
the rest safe:

| Category | Means |
| --- | --- |
| `backlog` | Not committed to yet |
| `unstarted` | Accepted, not begun |
| `started` | Work in flight, whatever the team calls the stages of it |
| `done` | Finished |
| `cancelled` | Closed without being delivered |

Nothing outside `backend/lib_softtrack/statuses.py` asks a status for its name.
Burndown, velocity, cycle completion, "3 of 5 sub-issues done", and whether a
blocker still blocks all read the *category* — so a column called "Shipped"
counts as finished everywhere without a single call site learning about it, and
one called "Blocked" is work in flight rather than a new kind of thing. The five
cannot be added to. That is the line between a workflow and a workflow engine,
and unconstrained workflow states are how Jira became Jira.

Changing the columns is a **team admin** action, unlike labels and projects
which any member creates: this is the shape of everyone's board.

**Deleting a status asks where its issues go.** It is a required choice, not a
default — issues are the point of the tracker, and guessing which column
somebody's work should land in is not a decision to make on their behalf. A
team always keeps at least one status. Saved views filtering on a deleted
status lose that one filter rather than the whole view, and no history is
written for the move: the work did not change state, the column under it was
removed, and a status event per issue would put a step in every cumulative flow
diagram on the day an admin tidied up the board.

**History records categories, not statuses.** An `issueevent` row for a status
change stores `started`, not "In Review". A chart of the past has to keep
meaning something after a team renames a column, merges two, or deletes one —
and the five categories are the only vocabulary that survives all of that. The
cost is real and worth knowing: a cumulative flow diagram shows five bands, and
cannot separate "In Progress" from "In Review", because by the time it is drawn
both are `started`. Recording status ids instead would give sharper charts that
break the first time somebody rearranges the board. It also means moving an
issue between two columns in the same category writes no history row at all,
which is correct: nothing about the work changed.

The Jira importer prefers a column the team already calls the same thing before
falling back to the category, so importing "In Review" lands in a team's own
"In Review" rather than merging into whatever else is `started`.

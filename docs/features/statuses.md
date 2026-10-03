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
Burndown, velocity, sprint completion, "3 of 5 sub-tickets done", and whether a
blocker still blocks all read the *category* — so a column called "Shipped"
counts as finished everywhere without a single call site learning about it, and
one called "Blocked" is work in flight rather than a new kind of thing. The five
cannot be added to. That is the line between a workflow and a workflow engine,
and unconstrained workflow states are how Jira became Jira.

Changing the columns is a **team admin** action, unlike labels and epics
which any member creates: this is the shape of everyone's board. (Deleting a
label is an admin's too, since it rewrites views and rules: see
[Labels](labels.md).)

**Deleting a status asks where its tickets go.** It is a required choice, not a
default — tickets are the point of the tracker, and guessing which column
somebody's work should land in is not a decision to make on their behalf. A
team always keeps at least one status. Saved views filtering on a deleted
status lose that one filter rather than the whole view, and no history is
written for the move: the work did not change state, the column under it was
removed, and a status event per ticket would put a step in every cumulative flow
diagram on the day an admin tidied up the board.

**History records categories, not statuses.** An `ticketevent` row for a status
change stores `started`, not "In Review". A chart of the past has to keep
meaning something after a team renames a column, merges two, or deletes one —
and the five categories are the only vocabulary that survives all of that. The
cost is real and worth knowing: a cumulative flow diagram shows five bands, and
cannot separate "In Progress" from "In Review", because by the time it is drawn
both are `started`. Recording status ids instead would give sharper charts that
break the first time somebody rearranges the board. It also means moving an
ticket between two columns in the same category writes no history row at all,
which is correct: nothing about the work changed.

The Jira importer prefers a column the team already calls the same thing before
falling back to the category, so importing "In Review" lands in a team's own
"In Review" rather than merging into whatever else is `started`.

## WIP limits

A status can say how many tickets it should hold at once (#270): a number in
its row under **Settings → *Team* → Statuses**, set by a team admin, blank for
no limit.

- **The column counts against it**: "4 / 3". Full, it says **full**; over,
  **over by 1**, with an icon, since colour alone would not reach everyone.
  The count is the whole stage on the team, whatever the board is filtered
  to (`wip_count` in the team's estimates), so a filtered board still shows
  how much work is in the column.
- **By default a limit warns.** Dropping a card into a full column is
  allowed, the header goes over, and the drop is announced as "Moved ENG-24
  to In Progress. In Progress is now over its limit, 4 of 3." -- the keyboard
  move (#80) and a pointer alike.
- **Refuse a card over the limit** (a team setting under the same page)
  makes it hard. Then every way a ticket changes status into a full column
  is refused with `409 wip_limit_reached` and a sentence ("In Progress is
  full. It holds 3, and this would make 4. Finish or move one first."): an
  edit, the board's drag and drop (the card goes back, and the sentence shows
  above the board), bulk edit (all or nothing), creating a ticket into the
  column, and moving one to another team into a full column there. An
  automation rule skips the move instead of failing what set it off, and its
  run log says why. Tickets already in the column, and moves out of it, are
  never held back.
- **Sub-tickets count against limits** is on by default; off, only the work
  they are part of counts.
- **On the chart.** The cumulative flow chart draws a stage's limit -- the sum
  of its columns' limits, where every column in the stage has one -- as a
  dashed line that far above the band's lower edge.

Grouped by epic, the board has no status columns to show a limit on; the
limit is on the stage and holds all the same. A Jira import and deleting a
status move tickets wherever they must go, and are not held back by a limit.
Not here, on purpose: a limit per person or per swimlane.

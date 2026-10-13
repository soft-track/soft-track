# Sprints and estimates

A sprint is a time-boxed iteration. It has a name (or just "Sprint 7"), a
start, an end, and a state. Until #214 the interface and the API called it a
cycle.

**State is set, not derived.** A sprint could infer "active" from today falling
between its dates, but then a team that forgets to start on Monday has Monday
counted against its burndown, and a sprint that runs a day long completes itself
overnight and carries work away while nobody is looking. The dates are the
plan; the state is what actually happened.

**Completing a sprint never deletes work.** Unfinished tickets move to the next
upcoming sprint, or back to the backlog if there is none, and the completion
response says how many moved and where they went. A sprint boundary is an
accounting event, not a reason to lose anything. Cancelled tickets count as
finished for this purpose — they are not outstanding work, and dragging them
forward for ever would be wrong.

**Estimates are story points on a fixed scale: 1, 2, 3, 5, 8.** The gaps are
the point. They stop a team arguing about whether something is a 6 or a 7, a
distinction no estimate is accurate enough to carry. Anything off the scale is
refused with a 422 that names the scale. Null means *not sized yet*, which is
deliberately distinct from an estimate of zero — and the sprint's progress
reports the unsized count alongside the totals, because a points total is only
as honest as that number is small.

Rollups per status and per assignee are computed in two grouped queries rather
than by summing the ticket list in the browser. The list is paginated, so a
client-side total would quietly be "the total of whatever page happened to be
loaded" — a different and much less useful number, with nothing on screen to
say so.

## Goals and retrospectives

A sprint can say **what it is for** (#271): a sentence or two, written when it
is planned, shown under its name in the sidebar and above its board.

**Completing a sprint asks two more things**, both optional: whether the goal
was **met, partly met or missed**, and the **retrospective** -- what went
well, what did not, and what to change, three markdown sections. Either can
be filled in later from the completed sprint's page (select it in the
sidebar), where:

- anybody on the team but a guest writes to it, until a team admin closes it
  (`409 retrospective_closed` after);
- each line of "what to change" has **Make a ticket**, which puts a ticket on
  the backlog titled with the line and saying which sprint's retrospective it
  came from, and shows its key beside the line from then on;
- guests read all of it.

While an upcoming sprint is selected, the last three completed ones are
listed under its banner with their goal, outcome, points and how many actions
came out of them: the next planning starts by reading the last. The
`sprint.started` and `sprint.completed` webhooks carry the goal and the
outcome.

Not here, on purpose: anonymous voting, timers, and a board of cards in
columns for the retrospective.

## Capacity

The **Plan** tab, beside Reports, shows a sprint against what the team can
take: a row per person with what is assigned to them in the sprint against
their capacity, the days they are here ("8 of 10 days · away 2 days"), and
"room for 3" or, in red and in words, "over by 3". Unassigned tickets in the
sprint are a row of their own, and the sprint's scope sits beside its total
capacity. Over capacity is shown, never refused: assigning carries on as
before, and nothing is assigned or levelled for anybody.

It plans the next sprint to start, or the one under way when none is lined
up; any other sprint can be picked. It counts in the unit the team estimates
in: points, hours (the tickets' time estimates), or a choice of either for a
team that estimates in both.

Capacity starts from the team's default under Settings → General → Capacity:
10 points for a whole sprint and 6 hours for each working day, until an admin
changes them. Working days are the weekdays from the sprint's first day to its
last. **Set capacity** changes it per person and per sprint: the days somebody
is here, which shrink the points in proportion and the hours day by day, and a
capacity typed by hand, which replaces the default in its unit. The days away
are entered by hand for now; approved leave and public holidays will fill
them in when SoftTrack has them.

Under the table, the last three completed sprints are a line to plan against
("The last three sprints delivered 34, 39 and 36 points: 36 on average"), and
a chart shows each of them, what it held when it started against what it
delivered, beside what the planned sprint holds.

Guests have no capacity and no row. Capacity is per team: somebody on two
teams has one in each, and their workload tab shows each team's, in the sprint
it is planning.

## Due dates

A ticket can have a due date, which is a day rather than a time, set from the
new-ticket form or the ticket panel. Cards and list rows show it compactly
("Sep 12"). Once the date has passed on a ticket that's still open, it turns
red and reads as overdue in words too, so colour isn't the only signal. Finished
or cancelled work is never overdue, however late it was finished.

The board and list can be filtered to **overdue**, **due this week** (from
today to Sunday) or **no due date**, alongside the other filters. The filter
goes in links as `?due=overdue` and saved views keep it. "Today" is the
viewer's own date, which the browser sends along with the filter, so "this
week" means their week and not the server's.

Due-date changes appear in the ticket's Activity feed. Deliberately not
included yet: reminders, a calendar view, recurring dates, and automation on a
date passing. SoftTrack has no scheduler, and "a date passed" is the one kind
of event that needs one.

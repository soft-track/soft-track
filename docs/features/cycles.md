# Cycles and estimates

A cycle is a time-boxed iteration — a sprint, if that is the word your team
uses. It has a name (or just "Cycle 7"), a start, an end, and a state.

**State is set, not derived.** A cycle could infer "active" from today falling
between its dates, but then a team that forgets to start on Monday has Monday
counted against its burndown, and a cycle that runs a day long completes itself
overnight and carries work away while nobody is looking. The dates are the
plan; the state is what actually happened.

**Completing a cycle never deletes work.** Unfinished issues move to the next
upcoming cycle, or back to the backlog if there is none, and the completion
response says how many moved and where they went. A cycle boundary is an
accounting event, not a reason to lose anything. Cancelled issues count as
finished for this purpose — they are not outstanding work, and dragging them
forward for ever would be wrong.

**Estimates are story points on a fixed scale: 1, 2, 3, 5, 8.** The gaps are
the point. They stop a team arguing about whether something is a 6 or a 7, a
distinction no estimate is accurate enough to carry. Anything off the scale is
refused with a 422 that names the scale. Null means *not sized yet*, which is
deliberately distinct from an estimate of zero — and the cycle's progress
reports the unsized count alongside the totals, because a points total is only
as honest as that number is small.

Rollups per status and per assignee are computed in two grouped queries rather
than by summing the issue list in the browser. The list is paginated, so a
client-side total would quietly be "the total of whatever page happened to be
loaded" — a different and much less useful number, with nothing on screen to
say so.

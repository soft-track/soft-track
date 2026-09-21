# Automation rules

Repetitive bookkeeping — assigning, labelling, moving finished work — done by a
rule instead of by hand. A rule is one **trigger**, any number of
**conditions**, and the **actions** to take on an issue that matches. Team
admins write them under *Settings → your team → Automation*; any member can
read them, and the log.

| Trigger | Fires when |
| --- | --- |
| `issue_created` | An issue is filed |
| `status_changed` | It moves to a different column |
| `issue_assigned` | Somebody is put on it |
| `comment_added` | A comment is posted |
| `cycle_completed` | A cycle finishes, once per issue that was in it |
| `branch_created` | A branch naming it appears in a connected repository |
| `pull_request_opened` | A pull or merge request naming it opens |
| `pull_request_merged` | ...and merges. Closed-without-merging is not this |

The last three arrive from a connected repository rather than from somebody
using the tracker — see [GitHub and GitLab](git-integrations.md).

Conditions are status, priority, label, project and assignee (or "nobody is
assigned"). They are ANDed, and unset means "no opinion" — a rule with none of
them fires on everything its trigger reaches. Actions set the status, priority,
assignee or cycle, add a label, or post a comment; at least one is required,
because a rule that does nothing is a rule that will be read as broken. There is deliberately no "every Monday" for rules a person triggers, no OR, no
negation and no branching. Two rules say "or" perfectly well, and each of the
others is a step towards the workflow engine SoftTrack is trying not to become.
It is the same line the five status categories draw.

**A rule's own changes never fire another rule.** The engine writes to the issue
row directly rather than going back through the update endpoint, so there is no
path from an action to a trigger — not one broken by a depth counter, one that
does not exist. Which rules match is also decided *before* any of them run, so
a rule cannot be set off by the rule above it in the list either. One thing
happening is one pass; two rules that point at each other simply take turns
being last rather than looping. Within that pass they run in the order they
were written, and the last one to set a field wins.

**Nothing is attributed to a person who did not do it.** The actor on the
history rows, the notifications and the comments an automation writes is null,
not whoever tripped the rule — which is why `comment.author_id` is nullable and
why such a comment renders as *Automation* rather than borrowing somebody's
initials. Someone dragging a card should not find their name on four changes
they did not make. The people a rule's change concerns are still told about it:
"nobody is notified about their own action" is about recognising what you just
did, and an issue that moved on its own is the opposite of that.

**Every automated change is logged, and the log outlives the rule.** The run
log records what changed, on which issue, and who did the thing that set the
rule off — and only when something actually changed, so a rule setting a status
to the one the issue was already in writes nothing. Deleting a rule keeps its
rows and nulls their link to it, because "which rule did this" is most often
asked immediately before deleting the rule that did it. The log is capped per
team and pruned as it is written; automation without a trace is a tracker that
edits itself and will not say why, and the first surprising change costs more
trust than the rules save in a year.

Two things follow from rules being real rows rather than a blob of JSON, the
same way they do for saved views. A rule naming another team's status is
refused when it is saved, not left matching nothing for ever. And when
something a rule names goes away, somebody has to decide what happens:
**deleting a status sends the rules after the issues** to whichever column
those moved to — clearing the reference would turn a condition into "no
opinion" and quietly widen the rule to every issue on the team — while
**deleting a cycle switches off the rules that filled it**, since there is
nowhere equivalent to send them and a rule left enabled would silently do less
than it says.

# Saved views and shareable filters

Six things narrow the board — status, priority, assignee, label, project and
cycle — and they compose. The **Filter** button in the top bar holds all of
them; whatever is active shows as a chip beside it, because a board narrowed by
a filter you cannot see is a board that looks like it has lost your issues.

**Every filter is in the URL.** `/ENG?priority=urgent&label=3` is the whole
state, so any board anyone is looking at is a link they can paste, the back
button works, and a reload lands where you were. The URL carries the *filters*
rather than a view id on purpose: a link to a private view's filters still
works for a colleague who cannot see that view, and it still lights up the
matching row in the sidebar for someone who can.

**Filtering happens on the server.** It used to run in the browser over the
page that was already loaded, which quietly meant "urgent issues among the
fifty most recent" — a different and much less useful thing, and no way to
tell from looking. This is the reason the issue list grew `label_id` and
`unassigned` parameters.

**Saving one.** With filters active, **Save view** names them. A view is
private until you share it, after which the whole team has it in their sidebar
— any member can share one, because a tracker where a useful filter needs an
admin to publish it is a tracker where people paste URLs to each other instead.
Its owner can rename, re-share or delete it; so can a team admin, so that a
shared view does not become permanent when the person who made it leaves.

**Where the board opens.** A team admin can make a shared view the team's
default, and anyone can override that for themselves from the same menu. The
precedence — your choice, else the team's, else all issues — is resolved by the
API and handed to the client as `effective_default_id`, so there is one place
that rule lives. It applies when you arrive with no filters in the URL;
clearing the filters yourself keeps them cleared.

Two things that follow from views being real rows rather than a blob of JSON:
a filter pointing at another team's label is refused when the view is saved
rather than silently matching nothing for ever, and deleting a cycle clears it
from the views that filtered on it.

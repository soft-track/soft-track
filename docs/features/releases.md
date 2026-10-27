# Releases

A sprint says when work was done and an epic what it was part of. A
**release** says which version it shipped in (#272), so "is this fixed in what
the customer runs?" has an answer that is not somebody's memory.

A release belongs to a team: a **name** ("1.4.0", once per team, as typed), a
**description**, a **target date**, and a **state** of planned, released or
archived. It is a name for a set of tickets and nothing more: there is no
deploy and no build pipeline behind it.

## Fix version

A ticket has one **fix version**: the release it ships in. It sits in the
ticket's properties, where a bug calls it **Fixed in**. A team that has made no
release is asked nothing about one: the field, the filter and the grouping only
appear once it has made one (a ticket that already ships in a release keeps
showing it). An archived release is not offered in the pickers; tickets that
point at it keep pointing at it.

Changing a fix version is in the ticket's Activity ("moved this from 1.4.0 to
1.5.0"), by name. Moving a ticket to another team leaves its release behind, as
it does its sprint.

## The Releases tab

**Releases** is a tab beside Reports. The team's releases are listed on the
left -- planned first, then released, newest first in each, with the archived
ones apart -- and one of them on the right:

- its state, description and target date (or the day it shipped);
- its **progress**, in points and in tickets: "11 of 16 pts · 3 of 5 tickets".
  Cancelled tickets are left out of both numbers, as they are from a parent's
  sub-ticket progress: they will not ship, and nothing is waiting on them;
- **what is not done yet**, first -- it is what the release is waiting for --
  then what is done.

Anybody on the team but a guest makes, edits, archives and deletes releases.
Guests read them, and the notes. An account from outside the organisation does
not have the tab.

## Releasing

**Release** sets the day it shipped (today, unless somebody says otherwise) and
asks what to do with the tickets that are not done: **move them to the next
release** -- the soonest planned one is suggested -- or **leave them without a
release**. Each moved ticket's history says so. Cancelled tickets stay where
they are.

Releasing is the only way to `released`: `PATCH` refuses to mark a release
released by hand (`409 release_not_released`), because that would skip the
question. A released release can be reopened (back to planned, forgetting the
day it shipped), its day corrected, archived and unarchived.

Deleting a release leaves its tickets in no release, through their history;
the saved views that filtered on it forget it; and a rule that set it is
switched off, as one that moved work into a deleted sprint is.

## Release notes

**Release notes** drafts the notes from the done tickets, grouped by type:
**Stories**, then **Bugs fixed**, then **Tasks**, each line the ticket's title
and key. A sub-ticket whose parent is in the notes is left to its parent. The
draft is markdown for a person to edit, then copy or download as a `.md` file.
Nothing keeps it: it is drafted fresh from what is done each time.

## Elsewhere

- **The roadmap** marks each release in the month of its day -- the day it
  shipped, or the day it is for -- above that month's epics.
- **The board and the list** filter by release (several at once, or every
  release but some) and on having none ("Has no release"), and group by
  release: a column per release and one for none. Dragging a card to another
  release's column sets its fix version. Saved views keep both.
- **Automation rules** can **set the fix version** to a planned release. A
  release that has shipped is not offered, and a rule that fires after its
  release has gone out skips it and says so in the run log.
- **The CSV export** has a `fix_version` column, by name.

## API

`GET` and `POST /teams/{team_id}/releases`, in the shape sprints have;
`GET`, `PATCH` and `DELETE /releases/{release_id}`;
`POST /releases/{release_id}/release` with `released_on` and
`move_to_release_id`, both optional; and `GET /releases/{release_id}/notes`.
Tickets take `fix_version_id`, and the ticket list filters on `fix_version_id`
(repeat it for several), `fix_version_exclude` and `has_no=fix_version`.

## Not here

Creating a release from a git tag would be a good follow-up for the GitHub and
GitLab integration. A release here is a name for a set of tickets; it does not
deploy anything.

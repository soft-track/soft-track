# Opening an issue: the panel and the page

An issue has one address, `/ENG/issue/42`, and it's the one people paste.
What you see at that address depends on how you got there, not on the
address.

- **The panel** slides over the board. Opening a card on the board, a row in
  the list or an issue in the calendar gives you the panel, with the board
  still under it. Close it (or press `Esc`) and you're back where you were,
  same view, same scroll.
- **The page** stands on its own, with no board loading behind it. A pasted
  link, the command palette, a search result and a notification all open
  the page, and so does reloading a page.

The choice lives in the browser's history entry rather than in the URL. That
way the link you copy from either surface is the same link, and a reload
keeps whichever surface you were on.

## The page

The header shows where the issue sits: the team, then the parent issue if it
has one, then the issue itself. On a phone, the team is a back button.
**Copy link** copies the page's own address, and **Watch** and the ⋯ menu
work as they do on the panel.

Below the header is the same issue the panel shows: the title and
description, files, properties, sub-issues, links, time and the Activity
feed. On a wide screen the properties, labels and linked code move into a
column beside the description, so they don't break up the reading. On a
narrow one they stack between the description and the rest, the way the
panel always had them. The layout follows the width the issue is given (a
CSS container query), not the kind of surface, so a narrow page and the
panel look alike.

`S`, `P`, `A` and `L` jump to status, priority, assignee and labels on the
page as they do on the panel. `Esc` has nothing to close on the page.

Following a link from inside an issue keeps you on the surface you're on. A
sub-issue, a parent, a linked issue, or the issue's new address after it
moves teams opens in the panel if you're in the panel, and as a page if
you're on a page.

**Back returns to the board as you left it.** Leaving the board for a page
unmounts it. The view you were on (board, list, calendar and so on) and your
search text are saved to the board's history entry first, so pressing Back
brings back the same view and the same search results. Filters were already
in the board's URL.

## For developers

- `frontend/src/issues/IssueDetailBody.tsx` is everything below the header.
  The panel (`IssueDetailPanel.tsx`) and the page (`IssuePage.tsx`) each
  render it under their own chrome. Its layout is `.issue-body` in
  `frontend/src/index.css`.
- `frontend/src/issues/surface.ts` holds the rule. `useOpenIssue(issue,
  surface)` navigates with or without the panel's state, and
  `useOpenRelatedIssue()` asks the surface the body is on. Sections call the
  second one, so none of them needs to know where it's rendered.
- `frontend/src/app/TeamRoute.tsx` picks the board or the page for every
  `/:teamKey` route. It's one element for all of them, which is what keeps
  the same board mounted when the panel opens over it.
- The page finds the issue with `GET /teams/{team_id}/issues/by-number/{number}`
  (#111), then reads it by id like the panel does.

# Opening an issue: the peek, the panel and the page

An issue has one address, `/ENG/issue/42`, and it's the one people paste.
What you see at that address depends on how you got there, not on the
address. Before any of that there's the quick peek, which has no address
at all.

- **The panel** slides over the board. Opening a card on the board, a row in
  the list or an issue in the calendar gives you the panel, with the board
  still under it. Close it (or press `Esc`) and you're back where you were,
  same view, same scroll. **Open as page**, the arrows beside the close
  button, trades the panel for the page.
- **The page** stands on its own, with no board loading behind it. A pasted
  link, the command palette, a search result and a notification all open
  the page, and so does reloading a page. So does a card or a list row
  opened in a new tab.

The choice lives in the browser's history entry rather than in the URL. That
way the link you copy from either surface is the same link, and a reload
keeps whichever surface you were on.

Cards and list rows are links to that address, so the browser treats them
like any other link: hovering one shows where it goes, and right-clicking it
offers to copy the address or open it in a new tab. A plain click still opens
the panel. `⌘`/`Ctrl`-click and `Shift`-click still select (see
[Keyboard](keyboard.md)), so to open a card in a new tab, middle-click it. A
guest has nothing to select, so for them `⌘`/`Ctrl`-click opens a new tab,
as on any other link.

## The quick peek

Sometimes you want one thing from a card: who has it, what the description
says, whether it's blocked. For that there's the peek. It's a read-only card
that appears beside the one you're looking at, on the board or in the list:

- **Space** on a focused card or list row opens it, and Space again closes
  it. As you arrow from card to card the peek follows the focus.
- **Rest the mouse** on a card or row for 400 ms and it opens; move off and
  it goes. The delay is the design: any shorter and the board flickers with
  previews as the pointer crosses it. Touch screens get no hover peek, since
  there is no hover to rest with.
- **Enter** opens the peeked issue as a page. **Escape** closes the peek and
  nothing else: not your selection, not anything open underneath.

The peek shows what the board already knows: title, status, assignee,
priority, estimate, due date, project, labels, the first lines of the
description as plain text, sub-issue progress and how many issues block it.
It makes **no requests**. Nothing loads, which is what makes it a peek. It
doesn't change the URL, move focus or your selection, and it isn't one of
the board's overlays. It never covers the card it describes, and it moves to
the other side of the card near the edge of the screen. In the list it sits
above or below the row instead.

Because Space now peeks, keyboard drag picks a card up with **Shift+Space**;
see [Keyboard](keyboard.md).

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
in the board's URL. Leaving by the panel's **Open as page** saves them the
same way, and Back brings the panel back, over the view you left.

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
- Cards and list rows are `<a href>` elements pointing at the issue's
  address. Their click handlers deal with a plain click (`isPlainClick` in
  `surface.ts`) and the selection gestures, and leave every other click to
  the browser. A card is also dnd-kit's drag handle, and it follows the
  pointer, so a drop can end in a click on the card that was carried.
  `frontend/src/board/DropIsNotAClick.tsx` stops that click from following
  the link.
- The page finds the issue with `GET /teams/{team_id}/issues/by-number/{number}`
  (#111), then reads it by id like the panel does.
- The peek is `frontend/src/board/usePeek.ts` (state and the hover delay),
  `peekContext.ts` (what a card or row wires up) and `IssuePeek.tsx` (the
  card itself, drawn in a portal and positioned by `placePeek` in
  `peek.ts`). `BoardPage` owns the one peek and passes it the board's own
  list, so what it shows is always the board's current copy.

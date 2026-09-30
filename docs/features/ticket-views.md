# Opening a ticket: the peek, the panel, the modal and the page

A ticket has one address, `/ENG/ticket/42`, and it's the one people paste.
What you see at that address depends on how you got there, not on the
address. Before any of that there's the quick peek, which has no address
at all. And a ticket you reach from inside another one (its blocker, a
sub-ticket, the parent) opens in a modal over the one you were reading,
which also keeps its address; see [below](#a-linked-ticket-in-a-modal).

- **The panel** slides over the board. Opening a card on the board, a row in
  the list or a ticket in the calendar gives you the panel, with the board
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
- **Enter** opens the peeked ticket as a page. **Escape** closes the peek and
  nothing else: not your selection, not anything open underneath.

The peek shows what the board already knows: title, status, assignee,
priority, estimate, due date, epic, labels, the first lines of the
description as plain text, sub-ticket progress and how many tickets block it.
It makes **no requests**. Nothing loads, which is what makes it a peek. It
doesn't change the URL, move focus or your selection, and it isn't one of
the board's overlays. It never covers the card it describes, and it moves to
the other side of the card near the edge of the screen. In the list it sits
above or below the row instead.

Because Space now peeks, keyboard drag picks a card up with **Shift+Space**;
see [Keyboard](keyboard.md).

## The page

The header shows where the ticket sits: the team, then the parent ticket if it
has one, then the ticket itself. On a phone, the team is a back button.
**Copy link** copies the page's own address, and **Watch** and the ⋯ menu
work as they do on the panel.

Below the header is the same ticket the panel shows: the title and
description, files, properties, sub-tickets, links, time and the Activity
feed. On a wide screen the properties, labels and linked code move into a
column beside the description, so they don't break up the reading. On a
narrow one they stack between the description and the rest, the way the
panel always had them. The layout follows the width the ticket is given (a
CSS container query), not the kind of surface, so a narrow page and the
panel look alike.

`S`, `P`, `A` and `L` jump to status, priority, assignee and labels on the
page as they do on the panel. `Esc` has nothing to close on the page, except
a modal over it.

A sub-ticket, the parent or a linked ticket opens in a modal over the ticket
you're on, the page or the panel alike (next section). A ticket that moves to
another team is different: that's the ticket in front of you changing its
address, so its new address opens on the surface you're on, in the panel if
you're in the panel and as a page if you're on a page.

**Back returns to the board as you left it.** Leaving the board for a page
unmounts it. The view you were on (board, list, calendar and so on) and your
search text are saved to the board's history entry first, so pressing Back
brings back the same view and the same search results. Filters were already
in the board's URL. Leaving by the panel's **Open as page** saves them the
same way, and Back brings the panel back, over the view you left.

## A linked ticket, in a modal

Looking at a blocker is almost never a decision to stop reading this ticket.
It's a question about this one: is that done yet? So clicking a row under
**Blocked by** or any other link, a sub-ticket, or the parent chip opens that
ticket in a modal over the one you're reading, from the panel or from a page.
Nothing underneath is left: its scroll position, a comment you're halfway
through, and the row you clicked are all still there when the modal closes.

- **It's the whole ticket, and you can change it.** The modal shows the same
  body as the panel and the page. Ticking a blocker to Done from here is the
  point. When the modal closes, the ticket underneath refreshes, so its link
  row and its sub-ticket progress catch up.
- **It stands beside the panel,** not over it, when the screen is wide enough
  for both, so the row it came from stays in view, marked. Over a page on a
  wide screen it stands to the right, over the properties rather than the
  reading. On a phone it fills the screen, as the panel does.
- **It says where it came from.** A chip at the top left reads "from ENG-20",
  and pressing it goes back there. A second modal names the whole trail,
  "ENG-20 › ENG-25".
- **Two deep at most.** From the second modal, a link opens the ticket's own
  page instead of stacking a third, and its row says so ("Opens the page") on
  hover. Back from that page returns you to the panel or page you left, with
  both modals still open.
- **A ticket that's already open underneath isn't opened twice.** Every link
  shows on both of its tickets, so a blocker's modal lists the ticket it
  blocks: the one you were reading. Following it goes back down to it,
  closing the modals above.
- **`Esc` closes the top modal only,** and puts focus back on the row that
  opened it. `S`, `P`, `A` and `L` reach the fields of the ticket on top.
  A dialog opened over the modals, such as the cheatsheet, takes the first
  `Esc` for itself.
- **The address doesn't change,** so the link in the address bar is still the
  ticket you were reading. Each modal is its own history entry, so **Back
  closes the top modal** instead of leaving the ticket, and Forward opens it
  again. A reload keeps them open, as it keeps the panel.
- **Open as page** in the modal's header trades it for that ticket's page.
- A link can cross teams. The modal then offers that team's statuses, labels
  and people. If you're not on that team, it says so rather than showing the
  ticket.

## For developers

- `frontend/src/tickets/TicketDetailBody.tsx` is everything below the header.
  The panel (`TicketDetailPanel.tsx`), the page (`TicketPage.tsx`) and the
  linked-ticket modal (`TicketModal.tsx`) each render it under their own
  chrome. Its layout is `.ticket-body` in `frontend/src/index.css`.
- `frontend/src/tickets/surface.ts` holds the rule. `useOpenTicket(ticket,
  surface)` navigates with or without the panel's state, and
  `useOpenTicketHere()` stays on the surface you're on.
- The panel and the page each render their ticket inside `TicketStack.tsx`:
  the ticket at the bottom and the modals over it. The open modals live in the
  history entry's state (`ticketModals`, read and written by
  `tickets/modals.ts`), which is how Back closes one and a reload keeps them.
  Closing a modal any other way goes back one entry, so the history never
  holds a modal nobody can see. The stack owns the keys: one listener, so one
  `Esc` closes one layer. It defers to any other dialog that is on top
  (`topDialog()` in `ui/useFocusTrap.ts`). Sections open tickets through
  `useRelatedTickets()` (`tickets/stackContext.ts`), which says whether a
  ticket opens a modal, goes back down to one, or opens the page, so none of
  them needs to know where it's rendered.
- `frontend/src/app/TeamRoute.tsx` picks the board or the page for every
  `/:teamKey` route. It's one element for all of them, which is what keeps
  the same board mounted when the panel opens over it.
- Cards and list rows are `<a href>` elements pointing at the ticket's
  address. Their click handlers deal with a plain click (`isPlainClick` in
  `surface.ts`) and the selection gestures, and leave every other click to
  the browser. A card is also dnd-kit's drag handle, and it follows the
  pointer, so a drop can end in a click on the card that was carried.
  `frontend/src/board/DropIsNotAClick.tsx` stops that click from following
  the link.
- The page finds the ticket with `GET /teams/{team_id}/tickets/by-number/{number}`
  (#111), then reads it by id like the panel does.
- The peek is `frontend/src/board/usePeek.ts` (state and the hover delay),
  `peekContext.ts` (what a card or row wires up) and `TicketPeek.tsx` (the
  card itself, drawn in a portal and positioned by `placePeek` in
  `peek.ts`). `BoardPage` owns the one peek and passes it the board's own
  list, so what it shows is always the board's current copy.

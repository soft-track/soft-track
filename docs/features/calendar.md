# Calendar

The **Calendar** tab shows issues on the days they are due, a month at a
time: "what's due this week" as a picture instead of a filter. It sits beside
Board and List and uses the same filters, from the same URL, so a saved view
narrows the calendar exactly as it narrows the board.

- **A month grid, Monday to Sunday** — the same week "due this week" means.
  Each day shows up to three issues as chips (key, title and status colour)
  and counts the rest as **+N more**, which opens that day's full list.
- **Drag a chip to another day** to reschedule it. It moves at once and is
  saved in the background; if the save fails, the calendar refetches and it
  moves back. Guests see the calendar and cannot drag.
- **Month navigation** with the arrows and **Today**. The month is in the URL
  (`?month=2026-10`) — this month leaves it out — so a link to next month's
  calendar opens on next month, and changing a filter does not jump back.
- **Keyboard:** the grid takes one Tab stop, the focused day. Arrow keys move
  by day and week, Home and End to the ends of the week, Page Up and Page
  Down by a month — crossing into the next month as they go — and Enter opens
  the focused day's list. Moving a chip is by pointer; from the keyboard, set
  the due date in the issue's panel.

Built without a calendar library: a month grid is a CSS grid and a date-fns
loop, for the same reason the charts are hand-rolled. The calendar asks the
issue list for exactly the days on screen with `due_from` and `due_to`, up to
200 issues; a month with more than that says so and asks for narrower
filters.

Not included: week and day views, cycle overlays, iCal export.

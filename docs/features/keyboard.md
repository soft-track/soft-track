# Keyboard and the command palette

`⌘K` (`Ctrl+K` off a Mac) opens a palette that jumps to an issue or runs a
command; `/` focuses search, `C` creates an issue, `?` lists every shortcut,
and `Esc` closes whatever is open.

On the board, the arrow keys move between columns and cards and `Enter` opens
the focused one. `⌘`/`Ctrl`-click adds a card or list row to a selection and
`Shift`-click selects the range from the last one picked; a bar then sets
status, priority, assignee, project, cycle or labels on all of them in one
transactional request, or deletes them after a confirmation. Dragging a
selected card moves the whole selection, and `Esc` clears it.

**Cards move without a mouse.** On a focused card, Space picks it up. The
left and right arrow keys carry it one column at a time, up and down move it
past the cards above and below it in its column, and Space or Enter drops it. Escape puts it back where it was. Every step is
read out to screen readers in plain words ("Moved ENG-42 to In Progress"),
never as internal ids. Enter on a card that isn't picked up still opens the
issue, which is why Enter doesn't pick cards up. Moving a card that's part
of a selection moves the whole selection, just as dragging with the mouse
does.

On an open issue, `S`, `P`, `A` and `L` jump to status, priority, assignee and
labels — the panel prints those letters next to the
fields, so the shortcut is discoverable from the thing it acts on.

The shortcut table lives in one array in `frontend/src/keyboard/shortcuts.ts`,
which is both what the handlers dispatch on and what the cheatsheet renders. A
shortcut that works but is not listed may as well not exist; a listed one that
does not work is worse. One array makes both failures impossible.

**Dialogs keep keyboard focus inside them while they're open.** This applies
to every dialog that dims the page behind it: the new-issue and new-cycle
forms, the issue panel, the command palette, the cheatsheet, and so on.
Opening one moves focus into it. Tab and Shift+Tab cycle through its controls
and wrap at the ends, so they never reach the page behind it. Closing it puts
focus back on whatever opened it. Each of these dialogs is marked
`aria-modal="true"`, so a screen reader treats the rest of the page as inert.
All of this is one hook, `frontend/src/ui/useFocusTrap.ts`, so a new dialog
gets it by adding one line. The filter and notification dropdowns don't dim
the page and are deliberately left non-modal.

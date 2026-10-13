# Labels

A label is a team's own tag: a name and a colour, put on as many tickets as
need it. Tickets, saved views and automation rules all point at the label's
row rather than at its name, so a label is one thing however many tickets
carry it.

**Settings → *Team* → Labels** lists them (#321): each with its colour, its
name, the chip a card shows, and how many tickets carry it, so one nobody uses
is easy to see and easy to let go.

- **Renaming** is typing over the name. Enter or leaving the field saves it,
  and Escape puts it back. Every ticket carrying the label follows at once,
  which is how "Custmer request" gets fixed on all four tickets.
- **Recolouring** is the swatch, which opens a palette of ten.
- **Names are unique on a team whatever the case**, the way department names
  are: "feature" is refused where "Feature" exists, and the sentence says so.
  The API compares `label.name_key`, the name trimmed and case-folded, under a
  unique constraint with the team. Another team's labels are its own.
- **Deleting asks first.** A label can be **merged into** another one, or
  **removed** from its tickets. The dialog lists the saved views and
  automation rules that name it, with what each will do:

| | Merged into another label | Removed |
| --- | --- | --- |
| Tickets | carry the other label (once, if they had both) | lose it |
| Saved views filtering by it | filter by the other label | stop filtering by a label |
| Automation rules naming it | name the other label | are switched off, with the label taken out |

A rule is switched off rather than left running without its label. Cleared, a
condition would match every ticket, and an action would do less than the
rule says. It shows switched off under Automation, for somebody to decide what
it should say now. Private views are counted, not named, to anybody but the
person who saved them. No ticket history is written: nobody changed the
tickets, and a label tidied away is not a step in anybody's cumulative flow.

**Who may do what.** Anybody on the team but a guest adds, renames and
recolours labels, as they always could add one. Deleting is a **team admin's**,
because it rewrites saved views and automation rules, which are theirs to
change. Guests change nothing here: `tests/test_guest_role.py` sends both new
routes as a guest.

When this arrived, any labels on a team that differed only in case -- "Bug"
and "bug", which nothing refused before -- were merged into the oldest of
them by the migration, with their tickets, views and rules.

## API

| Route | |
| --- | --- |
| `GET /teams/{team_id}/labels` | The team's labels |
| `POST /teams/{team_id}/labels` | Add one: `name`, `color` (`#rrggbb`) |
| `PATCH /labels/{label_id}` | Rename or recolour |
| `DELETE /labels/{label_id}?merge_into=` | Delete, merging into another label or removing it. Team admins |
| `GET /teams/{team_id}/labels/usage` | Per label: tickets carrying it, saved views and rules naming it |

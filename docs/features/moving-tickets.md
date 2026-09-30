# Moving a ticket to another team

A ticket filed in the wrong team moves from the ⋯ menu in its panel: **Move to
another team…**. The dialog says what will change before anything does, and
the ticket keeps everything that belongs to it rather than to its team —
comments, files, history, links, watchers, and linked branches and pull
requests.

## What changes

Keys are per team, so the ticket takes the target team's next number:
`ENG-42` becomes `OPS-17`. The old key is not reused — ENG never hands out 42
again — and it stays findable: the move posts **"Moved from ENG-42."** on the
ticket, so searching for the old key finds the new one.

What belongs to the old team is remapped or cleared:

| | |
|---|---|
| **Status** | The target team's first status in the same category — `started` to `started`. If it has none, its first column. |
| **Labels** | Kept where the target team has one with the same name, ignoring case. Dropped otherwise. |
| **Sprint, epic** | Cleared. Both belong to one team. |
| **Assignee** | Kept if they can hold the target team's tickets, cleared if they are not on it or only a guest there. |
| **Custom fields** | Cleared. [Fields](custom-fields.md) are the old team's own; a "Reviewer" on the target team is a different field. |
| **Parent** | A sub-ticket moved on its own stops being one. Sub-tickets share their parent's team. |
| **Sub-tickets** | Move with their parent, by the same rules, each getting its own new key. |

Sub-tickets move rather than block the move because refusing would turn one
action into several and leave the hierarchy broken while they were done by
hand. The whole family moves in one transaction, or none of it does.

The move is recorded in the ticket's history ("moved this from ENG-42 to
OPS-17"), and the fields it clears are recorded the way any other change is,
so a sprint's burndown shows the ticket leaving it. It notifies nobody:
watchers who are not on the target team simply stop hearing about it, as
anyone who leaves a team does.

Moving needs write access to both teams, so a guest of either cannot.

## API

- `GET /tickets/{ticket_id}/transfer?team_id=…` — the plan, changing nothing.
  The key it reports is the one the ticket would get *now*; something else
  filed on the target team meanwhile takes that number, so the move returns
  the key it actually got.
- `POST /tickets/{ticket_id}/transfer` with `{"team_id": …}` — the move. Returns
  the ticket and any sub-tickets that came with it.

`transfer`, not `move`: `POST /tickets/{id}/move` is the board's drag within a
team, and predates this.

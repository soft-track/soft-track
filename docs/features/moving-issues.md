# Moving an issue to another team

An issue filed in the wrong team moves from the ⋯ menu in its panel: **Move to
another team…**. The dialog says what will change before anything does, and
the issue keeps everything that belongs to it rather than to its team —
comments, files, history, links, watchers, and linked branches and pull
requests.

## What changes

Keys are per team, so the issue takes the target team's next number:
`ENG-42` becomes `OPS-17`. The old key is not reused — ENG never hands out 42
again — and it stays findable: the move posts **"Moved from ENG-42."** on the
issue, so searching for the old key finds the new one.

What belongs to the old team is remapped or cleared:

| | |
|---|---|
| **Status** | The target team's first status in the same category — `started` to `started`. If it has none, its first column. |
| **Labels** | Kept where the target team has one with the same name, ignoring case. Dropped otherwise. |
| **Cycle, project** | Cleared. Both belong to one team. |
| **Assignee** | Kept if they are on the target team, cleared if not. |
| **Parent** | A sub-issue moved on its own stops being one. Sub-issues share their parent's team. |
| **Sub-issues** | Move with their parent, by the same rules, each getting its own new key. |

Sub-issues move rather than block the move because refusing would turn one
action into several and leave the hierarchy broken while they were done by
hand. The whole family moves in one transaction, or none of it does.

The move is recorded in the issue's history ("moved this from ENG-42 to
OPS-17"), and the fields it clears are recorded the way any other change is,
so a cycle's burndown shows the issue leaving it. It notifies nobody:
watchers who are not on the target team simply stop hearing about it, as
anyone who leaves a team does.

Moving needs write access to both teams, so a guest of either cannot.

## API

- `GET /issues/{issue_id}/transfer?team_id=…` — the plan, changing nothing.
  The key it reports is the one the issue would get *now*; something else
  filed on the target team meanwhile takes that number, so the move returns
  the key it actually got.
- `POST /issues/{issue_id}/transfer` with `{"team_id": …}` — the move. Returns
  the issue and any sub-issues that came with it.

`transfer`, not `move`: `POST /issues/{id}/move` is the board's drag within a
team, and predates this.

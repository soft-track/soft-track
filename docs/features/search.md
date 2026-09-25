# Search and saved views

SoftTrack includes free-text search across issues and comments, plus filterable saved views.

## Free-text search

Search works across an issue's title, description, and comments. This is a core product capability rather than a secondary feature, and it fits alongside the board filters and saved views.

It behaves the same on both databases. Every word must appear, in any order.
Words match their other forms, so "connection" finds "connecting". Results are
ranked by relevance, with issues whose own text matches ahead of issues found
only through a comment, and the most recently updated first among equals.

- **Postgres** uses `to_tsvector`/`plainto_tsquery`, ranked by `ts_rank` and
  backed by GIN indexes.
- **SQLite** uses FTS5: index tables over issue text and comment bodies, kept
  up to date by triggers and ranked by `bm25()` (#85). Porter stemming stands in
  for Postgres's English configuration, and accents are ignored, so "cafe"
  finds "Café". What people type is split into words and each word is quoted,
  so FTS5's own query syntax (`AND`, `NEAR(`, `*`, `column:`, unbalanced quotes)
  is treated as plain text rather than failing. A SQLite built without FTS5
  falls back to substring matching.

Anyone writing a migration should know one thing. SQLite batch migrations
rebuild a table by copying it, and that drops the table's triggers. A
migration that batch-alters `issue` or `comment` must recreate the index
triggers (see `backend/lib_softtrack/search_fts.py`).
`test_every_trigger_survives_every_migration` fails if one doesn't.

## Saved views and shareable filters

Six things narrow the board: status, priority, assignee, label, project, and cycle. They compose, and the active state is shown as chips beside the filter control.

**Every filter is in the URL.** `/ENG?priority=urgent&label=3` is the full state for a board, which makes it easy to share, reload, and use the browser back button. The URL carries the filters rather than a view id so a link still works even when the view itself is private.

**Filtering happens on the server.** That avoids quietly changing the meaning of the board by filtering only the already loaded page. The issue list includes the relevant parameters (`label_id`, `unassigned`, and similar) to make filtering consistent and useful.

**Saving one.** With filters active, **Save view** names them. A view is private until it is shared, after which the whole team can use it. Any member can share one; a team admin can also rename or delete a shared view if needed.

**Where the board opens.** A team admin can make a shared view the team's default, and anyone can override that for themselves. The precedence is: your choice, else the team's, else all issues.

Two follow-on rules matter:

- A saved view that points at another team's label is refused when it is saved.
- Deleting a cycle removes it from the views that filtered on it.

See also [../architecture.md](../architecture.md) and [../deployment.md](../deployment.md).

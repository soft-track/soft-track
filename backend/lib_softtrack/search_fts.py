"""SQLite's full-text index: FTS5 tables over issues and comments (#85).

Postgres searches with `to_tsvector` and GIN indexes; this is the SQLite
equivalent, so local and small self-hosted instances get ranked, stemmed
search too instead of `LIKE '%query%'`.

Two external-content FTS5 tables mirror `issue` (title, description) and
`comment` (body). "External content" means they hold only the index, not a
second copy of the text; triggers keep them in step with every write, from
whichever path -- the issue service, bulk edits, the Jira importer, a rule.

The same DDL is created two ways, and the two must agree:

* the migration that adds it (5b8e2d4c9a17), for every real database; and
* `create_all`, via the listener at the bottom of this module, for the
  in-memory databases the test suite builds without running migrations.

A test compares the two, so one cannot drift from the other unnoticed.

One trap worth knowing. A SQLite batch migration rebuilds a table by copying
it and dropping the original -- and the triggers go with the original. Any
future migration that batch-alters `issue` or `comment` must recreate the
triggers below, or the index silently stops following edits. A test that
runs every migration and then checks the triggers exist is there to catch it.
"""

import logging
import re

from sqlalchemy import event
from sqlalchemy.engine import Connection
from sqlmodel import SQLModel

logger = logging.getLogger(__name__)

#: Porter stemming ("deploying" finds "deploy", as Postgres's english config
#: does) over unicode61, which folds case and diacritics ("cafe" finds
#: "Café").
TOKENIZER = "porter unicode61"

DDL = [
    f"""CREATE VIRTUAL TABLE issue_fts USING fts5(
        title, description, content='issue', content_rowid='id',
        tokenize='{TOKENIZER}')""",
    f"""CREATE VIRTUAL TABLE comment_fts USING fts5(
        body, content='comment', content_rowid='id', tokenize='{TOKENIZER}')""",
    """CREATE TRIGGER issue_fts_insert AFTER INSERT ON issue BEGIN
        INSERT INTO issue_fts(rowid, title, description)
        VALUES (new.id, new.title, new.description);
    END""",
    """CREATE TRIGGER issue_fts_delete AFTER DELETE ON issue BEGIN
        INSERT INTO issue_fts(issue_fts, rowid, title, description)
        VALUES ('delete', old.id, old.title, old.description);
    END""",
    """CREATE TRIGGER issue_fts_update AFTER UPDATE OF title, description ON issue
    BEGIN
        INSERT INTO issue_fts(issue_fts, rowid, title, description)
        VALUES ('delete', old.id, old.title, old.description);
        INSERT INTO issue_fts(rowid, title, description)
        VALUES (new.id, new.title, new.description);
    END""",
    """CREATE TRIGGER comment_fts_insert AFTER INSERT ON comment BEGIN
        INSERT INTO comment_fts(rowid, body) VALUES (new.id, new.body);
    END""",
    """CREATE TRIGGER comment_fts_delete AFTER DELETE ON comment BEGIN
        INSERT INTO comment_fts(comment_fts, rowid, body)
        VALUES ('delete', old.id, old.body);
    END""",
    """CREATE TRIGGER comment_fts_update AFTER UPDATE OF body ON comment BEGIN
        INSERT INTO comment_fts(comment_fts, rowid, body)
        VALUES ('delete', old.id, old.body);
        INSERT INTO comment_fts(rowid, body) VALUES (new.id, new.body);
    END""",
]

#: The objects above, by name, for checking they exist.
OBJECTS = {
    "issue_fts": "table",
    "comment_fts": "table",
    "issue_fts_insert": "trigger",
    "issue_fts_delete": "trigger",
    "issue_fts_update": "trigger",
    "comment_fts_insert": "trigger",
    "comment_fts_delete": "trigger",
    "comment_fts_update": "trigger",
}


def fts5_supported(connection: Connection) -> bool:
    """Whether this SQLite build has FTS5. Nearly every one does; if not,
    search keeps its LIKE fallback rather than the app failing to start."""
    try:
        connection.exec_driver_sql(
            "CREATE VIRTUAL TABLE temp._fts5_probe USING fts5(x)"
        )
        connection.exec_driver_sql("DROP TABLE temp._fts5_probe")
        return True
    except Exception:  # noqa: BLE001 -- any failure means "not available"
        return False


def fts_query(text: str) -> str | None:
    """User input as an FTS5 query that cannot be a syntax error.

    FTS5 queries have their own grammar -- quotes, AND/OR/NOT, NEAR(), `*`,
    `column:` filters, `-` -- and raw input like `"foo AND bar` or `NEAR(`
    raises instead of matching. So the input is split into words and each is
    quoted as a string literal: every word must appear, in any order, which
    is what Postgres's `plainto_tsquery` means too. None when there are no
    words at all (`"!!!"`), which matches nothing -- as it does on Postgres.
    """
    words = re.findall(r"\w+", text)
    if not words:
        return None
    return " ".join('"' + word.replace('"', '""') + '"' for word in words)


@event.listens_for(SQLModel.metadata, "after_create")
def _create_for_create_all(_target, connection: Connection, **_kw) -> None:
    """Build the index wherever `create_all` builds a SQLite schema.

    That is the test suite's in-memory databases. Real databases get it from
    the migration, and never call `create_all`.
    """
    if connection.dialect.name != "sqlite":
        return
    if not fts5_supported(connection):
        logger.warning("SQLite has no FTS5; search falls back to LIKE.")
        return
    for statement in DDL:
        connection.exec_driver_sql(statement)

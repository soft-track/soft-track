"""The comment `edited_at` migration (#93), against a database with a comment in it.

One nullable column, so the risk is small and specific: that every existing
comment comes out never-edited, and that the downgrade -- which rebuilds
`comment` on SQLite -- keeps the comments and puts the search triggers back.
"""

import sqlite3

from alembic import command

from tests.test_reactions_migration import _config, _seed

BEFORE = "2a7c5e9b4f16"
AFTER = "c7e3a9d15b28"

_TRIGGERS = {"comment_fts_insert", "comment_fts_delete", "comment_fts_update"}


def _read(db_path, sql):
    connection = sqlite3.connect(db_path)
    try:
        return connection.execute(sql).fetchall()
    finally:
        connection.close()


def test_existing_comments_were_never_edited_and_the_column_comes_off_cleanly(
    tmp_path,
):
    db_path = tmp_path / "comments.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)
    _seed(db_path)

    command.upgrade(config, AFTER)
    assert _read(db_path, "SELECT body, edited_at FROM comment") == [
        ("Looks right", None)
    ]

    command.downgrade(config, BEFORE)
    columns = {row[1] for row in _read(db_path, "PRAGMA table_info(comment)")}
    assert "edited_at" not in columns
    assert _read(db_path, "SELECT body FROM comment") == [("Looks right",)]
    triggers = {
        row[0]
        for row in _read(db_path, "SELECT name FROM sqlite_master WHERE type='trigger'")
    }
    assert _TRIGGERS <= triggers

    # And the index still follows an edit made after the round trip.
    connection = sqlite3.connect(db_path)
    connection.execute("UPDATE comment SET body = 'Looks wrong' WHERE id = 1")
    connection.commit()
    hits = connection.execute(
        "SELECT rowid FROM comment_fts WHERE comment_fts MATCH 'wrong'"
    ).fetchall()
    connection.close()
    assert hits == [(1,)]

    command.upgrade(config, AFTER)

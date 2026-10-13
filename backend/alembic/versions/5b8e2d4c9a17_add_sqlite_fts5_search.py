"""add SQLite FTS5 search tables

Revision ID: 5b8e2d4c9a17
Revises: d3a8b1c5e270
Create Date: 2026-09-25

Issue #85. On SQLite, search used LIKE '%query%': no ranking, no stemming,
and a full scan. This adds FTS5 tables over issue text and comment bodies,
kept in step by triggers, and fills them from the rows already there.

SQLite only. Postgres has had GIN indexes since a3f1c9d24e70 and is left
alone. A SQLite built without FTS5 -- rare -- is skipped rather than failed:
search keeps its LIKE fallback there, and `docker compose up` still works.

The statements are copied here rather than imported from
lib_softtrack/search_fts.py, because a migration must keep meaning what it
meant when it ran. tests/test_search_fts.py checks the two still agree.
"""

import logging
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5b8e2d4c9a17"
down_revision: Union[str, Sequence[str], None] = "d3a8b1c5e270"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")

_TOKENIZER = "porter unicode61"

_DDL = [
    f"""CREATE VIRTUAL TABLE issue_fts USING fts5(
        title, description, content='issue', content_rowid='id',
        tokenize='{_TOKENIZER}')""",
    f"""CREATE VIRTUAL TABLE comment_fts USING fts5(
        body, content='comment', content_rowid='id', tokenize='{_TOKENIZER}')""",
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

_TRIGGERS = [
    "issue_fts_insert",
    "issue_fts_delete",
    "issue_fts_update",
    "comment_fts_insert",
    "comment_fts_delete",
    "comment_fts_update",
]


def _fts5_supported(bind) -> bool:
    try:
        bind.exec_driver_sql("CREATE VIRTUAL TABLE temp._fts5_probe USING fts5(x)")
        bind.exec_driver_sql("DROP TABLE temp._fts5_probe")
        return True
    except Exception:  # noqa: BLE001 -- any failure means "not available"
        return False


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        return
    if not _fts5_supported(bind):
        logger.warning("SQLite has no FTS5; search keeps its LIKE fallback.")
        return

    for statement in _DDL:
        op.execute(statement)
    # The backfill: 'rebuild' reads every row of the content table.
    op.execute("INSERT INTO issue_fts(issue_fts) VALUES ('rebuild')")
    op.execute("INSERT INTO comment_fts(comment_fts) VALUES ('rebuild')")


def downgrade() -> None:
    if op.get_bind().dialect.name != "sqlite":
        return
    for trigger in _TRIGGERS:
        op.execute(f"DROP TRIGGER IF EXISTS {trigger}")
    op.execute("DROP TABLE IF EXISTS comment_fts")
    op.execute("DROP TABLE IF EXISTS issue_fts")

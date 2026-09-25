"""add comment edited_at

Revision ID: c7e3a9d15b28
Revises: 2a7c5e9b4f16
Create Date: 2026-09-25

Issue #93: comments can be edited, and an edited one says so. One nullable
column, `comment.edited_at`; every existing comment was never edited, so
nothing needs a value.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "c7e3a9d15b28"
down_revision: Union[str, Sequence[str], None] = "2a7c5e9b4f16"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: The comment triggers from 5b8e2d4c9a17, for putting back after a rebuild.
_COMMENT_SEARCH_TRIGGERS = [
    "DROP TRIGGER IF EXISTS comment_fts_insert",
    "DROP TRIGGER IF EXISTS comment_fts_delete",
    "DROP TRIGGER IF EXISTS comment_fts_update",
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


def _has_search_index() -> bool:
    """False on a SQLite without FTS5, where 5b8e2d4c9a17 created nothing."""
    return (
        op.get_bind()
        .exec_driver_sql("SELECT 1 FROM sqlite_master WHERE name = 'comment_fts'")
        .first()
        is not None
    )


def upgrade() -> None:
    with op.batch_alter_table("comment", schema=None) as batch_op:
        batch_op.add_column(sa.Column("edited_at", sa.DateTime(), nullable=True))
    # add_column runs in place on SQLite, so the search index's triggers on
    # `comment` (5b8e2d4c9a17) survive the upgrade. tests/test_search_fts.py
    # fails if any migration loses them.


def downgrade() -> None:
    with op.batch_alter_table("comment", schema=None) as batch_op:
        batch_op.drop_column("edited_at")
    # Dropping a column rebuilds `comment` on SQLite, and the rebuild drops the
    # search index's triggers with the old table. Put them back, as they were
    # written in 5b8e2d4c9a17, or search would stop seeing edits.
    if op.get_bind().dialect.name == "sqlite" and _has_search_index():
        for statement in _COMMENT_SEARCH_TRIGGERS:
            op.execute(statement)

"""add due dates to issues

Revision ID: e6f0a3b7c912
Revises: 5b8e2d4c9a17
Create Date: 2026-09-25

Issue #87: `issue.due_date`, a saved view's `due` filter, and `due_date` as
something issue history records. Every existing issue has no due date and
every existing view no due filter, so nothing needs a value.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "e6f0a3b7c912"
down_revision: Union[str, Sequence[str], None] = "5b8e2d4c9a17"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DUE_FILTERS = ("overdue", "this_week", "none")

#: The issue triggers from 5b8e2d4c9a17, for putting back after a rebuild.
_ISSUE_SEARCH_TRIGGERS = [
    "DROP TRIGGER IF EXISTS issue_fts_insert",
    "DROP TRIGGER IF EXISTS issue_fts_delete",
    "DROP TRIGGER IF EXISTS issue_fts_update",
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
]


def _has_search_index() -> bool:
    """False on a SQLite without FTS5, where 5b8e2d4c9a17 created nothing."""
    return (
        op.get_bind()
        .exec_driver_sql("SELECT 1 FROM sqlite_master WHERE name = 'issue_fts'")
        .first()
        is not None
    )


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # Outside the transaction, as in a4d8e2c6f913.
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE issueeventfield ADD VALUE IF NOT EXISTS 'due_date'")

    due_filter = sa.Enum(*_DUE_FILTERS, name="duefilter")
    # add_column does not emit CREATE TYPE the way create_table does.
    due_filter.create(bind, checkfirst=True)

    with op.batch_alter_table("issue", schema=None) as batch_op:
        batch_op.add_column(sa.Column("due_date", sa.Date(), nullable=True))
        batch_op.create_index(batch_op.f("ix_issue_due_date"), ["due_date"])

    with op.batch_alter_table("savedview", schema=None) as batch_op:
        batch_op.add_column(sa.Column("due", due_filter, nullable=True))

    # add_column and create_index run in place on SQLite, so the search
    # index's triggers on `issue` (5b8e2d4c9a17) survive the upgrade.
    # tests/test_search_fts.py fails if any migration loses them.


def downgrade() -> None:
    with op.batch_alter_table("savedview", schema=None) as batch_op:
        batch_op.drop_column("due")

    with op.batch_alter_table("issue", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_issue_due_date"))
        batch_op.drop_column("due_date")
    # Dropping a column rebuilds `issue` on SQLite, and the rebuild drops the
    # search index's triggers with the old table. Put them back, as they were
    # written in 5b8e2d4c9a17, or search would stop seeing edits.
    if op.get_bind().dialect.name == "sqlite" and _has_search_index():
        for statement in _ISSUE_SEARCH_TRIGGERS:
            op.execute(statement)

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        postgresql.ENUM(name="duefilter").drop(bind, checkfirst=True)
    # The history rows go; the enum value stays (see b5e1f7a2c830).
    op.execute("DELETE FROM issueevent WHERE field = 'due_date'")

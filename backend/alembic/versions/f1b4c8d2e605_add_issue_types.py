"""add issue types: bug, task, story

Revision ID: f1b4c8d2e605
Revises: e6f0a3b7c912
Create Date: 2026-09-25

Issue #89. `issue.type`, NOT NULL, with every existing issue a task -- the
type that claims nothing about the work. Also a saved view's `type` filter,
and an automation rule's `if_type` condition and `set_type` action.

`issue.type` keeps its server default of 'task' rather than dropping it in a
second batch, as d8c2a6f41e93 did for projects. Dropping it would rebuild the
`issue` table on SQLite, which drops the search index's triggers
(5b8e2d4c9a17); a default that matches the model's own costs nothing.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "f1b4c8d2e605"
down_revision: Union[str, Sequence[str], None] = "e6f0a3b7c912"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TYPES = ("bug", "task", "story")

#: The issue triggers from 5b8e2d4c9a17, for putting back after the
#: downgrade's rebuild of `issue` -- see e6f0a3b7c912.
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


def upgrade() -> None:
    bind = op.get_bind()
    issue_type = sa.Enum(*_TYPES, name="issuetype")
    # add_column does not emit CREATE TYPE the way create_table does.
    issue_type.create(bind, checkfirst=True)

    with op.batch_alter_table("issue", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("type", issue_type, nullable=False, server_default="task")
        )
        batch_op.create_index(batch_op.f("ix_issue_type"), ["type"])

    with op.batch_alter_table("savedview", schema=None) as batch_op:
        batch_op.add_column(sa.Column("type", issue_type, nullable=True))

    with op.batch_alter_table("automationrule", schema=None) as batch_op:
        batch_op.add_column(sa.Column("if_type", issue_type, nullable=True))
        batch_op.add_column(sa.Column("set_type", issue_type, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("automationrule", schema=None) as batch_op:
        batch_op.drop_column("set_type")
        batch_op.drop_column("if_type")

    with op.batch_alter_table("savedview", schema=None) as batch_op:
        batch_op.drop_column("type")

    with op.batch_alter_table("issue", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_issue_type"))
        batch_op.drop_column("type")

    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        has_index = (
            bind.exec_driver_sql(
                "SELECT 1 FROM sqlite_master WHERE name = 'issue_fts'"
            ).first()
            is not None
        )
        if has_index:
            for statement in _ISSUE_SEARCH_TRIGGERS:
                op.execute(statement)
    if bind.dialect.name == "postgresql":
        postgresql.ENUM(name="issuetype").drop(bind, checkfirst=True)

"""add a manual rank to issues, for the board's order

Revision ID: 1c6e8a0f4b27
Revises: 07a9c3e5b1d4
Create Date: 2026-09-26

Issue #88, part 2. `issue.rank` is a fractional-indexing key (see
lib_utils/ranking.py), compared by code point -- declared COLLATE "C" on
Postgres, where the default collation would sort `a0` and `Zz` by locale.

Backfilled per team from the order the board already showed, newest first,
so nothing visibly moves on upgrade. The keys are consecutive integers in the
scheme's own encoding -- `a0`..`az`, then `b00`..`bzz`, then `c000`... --
which is exactly what appending one key after another produces. They are
computed here rather than by importing the application's generator, so this
migration keeps meaning what it meant; tests/test_board_rank.py checks the
two agree.

The column keeps a server default of '' (no key) rather than dropping it in a
second batch: dropping a default rebuilds `issue` on SQLite, and the rebuild
takes the search index's triggers with it (5b8e2d4c9a17). The application
never writes '' -- every new issue gets a key -- so the default is inert.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "1c6e8a0f4b27"
down_revision: Union[str, Sequence[str], None] = "07a9c3e5b1d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

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


def integer_key(n: int) -> str:
    """The n-th key counting up from `a0`: `a0`..`az`, `b00`..`bzz`, ..."""
    head, width, span = "a", 1, len(_DIGITS)
    while n >= span:
        n -= span
        head, width, span = chr(ord(head) + 1), width + 1, span * len(_DIGITS)
    digits = ""
    for _ in range(width):
        n, digit = divmod(n, len(_DIGITS))
        digits = _DIGITS[digit] + digits
    return head + digits


def upgrade() -> None:
    bind = op.get_bind()
    postgres = bind.dialect.name == "postgresql"
    if postgres:
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE issuesort ADD VALUE IF NOT EXISTS 'rank'")

    rank_type = sa.String(collation="C") if postgres else sa.String()
    with op.batch_alter_table("issue", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("rank", rank_type, nullable=False, server_default="")
        )
        batch_op.create_index(batch_op.f("ix_issue_rank"), ["rank"])

    rows = bind.execute(
        sa.text("SELECT id, team_id FROM issue ORDER BY team_id, number DESC")
    ).all()
    updates, position, team = [], 0, None
    for issue_id, team_id in rows:
        if team_id != team:
            team, position = team_id, 0
        updates.append({"id": issue_id, "rank": integer_key(position)})
        position += 1
    if updates:
        bind.execute(sa.text("UPDATE issue SET rank = :rank WHERE id = :id"), updates)


def downgrade() -> None:
    with op.batch_alter_table("issue", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_issue_rank"))
        batch_op.drop_column("rank")

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
    # 'rank' stays in the issuesort type on Postgres: an enum value cannot be
    # dropped without rebuilding the type, and an unused one is harmless.
    op.execute("UPDATE savedview SET sort = NULL WHERE sort = 'rank'")

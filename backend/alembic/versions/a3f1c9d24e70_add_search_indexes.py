"""add full-text search indexes

Revision ID: a3f1c9d24e70
Revises: e2b56dbe1777
Create Date: 2026-09-07

"""

from typing import Sequence, Union

from alembic import op

revision: str = "a3f1c9d24e70"
down_revision: Union[str, Sequence[str], None] = "e2b56dbe1777"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# These must stay character-identical to the expressions built in
# lib_softtrack/search.py. Postgres only uses an expression index when the
# query's expression matches it exactly, and a mismatch fails silently -- the
# search keeps working, just with a sequential scan.
#
# `||` rather than `concat_ws`: `concat_ws` is STABLE, and an index expression
# has to be IMMUTABLE.
_ISSUE_DOCUMENT = "to_tsvector('english', title || ' ' || coalesce(description, ''))"
_COMMENT_DOCUMENT = "to_tsvector('english', body)"


def upgrade() -> None:
    """Index the searchable text, on Postgres only.

    SQLite has no GIN and no tsvector; that dialect takes the LIKE path in
    search.py and needs no index of its own. Skipping rather than failing
    keeps `docker compose up` and the test suite working on SQLite.
    """
    if op.get_bind().dialect.name != "postgresql":
        return

    op.execute(f"CREATE INDEX ix_issue_search ON issue USING GIN ({_ISSUE_DOCUMENT})")
    op.execute(
        f"CREATE INDEX ix_comment_search ON comment USING GIN ({_COMMENT_DOCUMENT})"
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return

    op.execute("DROP INDEX IF EXISTS ix_comment_search")
    op.execute("DROP INDEX IF EXISTS ix_issue_search")

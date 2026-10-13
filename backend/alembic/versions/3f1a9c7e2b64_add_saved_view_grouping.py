"""add a grouping to saved views

Revision ID: 3f1a9c7e2b64
Revises: d8c2a6f41e93
Create Date: 2026-09-25

Issue #63. A saved view carries how the board is grouped -- by status, as it
always was, or by project -- as well as what it is filtered to.

Every existing view comes out grouped by status, which is exactly what it
showed before this column existed.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "3f1a9c7e2b64"
down_revision: Union[str, Sequence[str], None] = "d8c2a6f41e93"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_GROUPINGS = ("status", "project")


def upgrade() -> None:
    bind = op.get_bind()
    grouping = sa.Enum(*_GROUPINGS, name="issuegrouping")
    # add_column does not emit CREATE TYPE the way create_table does, so on
    # Postgres the type has to exist first. A no-op on SQLite.
    grouping.create(bind, checkfirst=True)

    # A server default so existing rows get a value, dropped again in a second
    # batch -- see d8c2a6f41e93 for why that has to be two batches on SQLite.
    with op.batch_alter_table("savedview", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("group_by", grouping, nullable=False, server_default="status")
        )

    with op.batch_alter_table("savedview", schema=None) as batch_op:
        batch_op.alter_column("group_by", existing_type=grouping, server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("savedview", schema=None) as batch_op:
        batch_op.drop_column("group_by")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # Postgres does not drop a type with the column that used it.
        postgresql.ENUM(name="issuegrouping").drop(bind, checkfirst=True)

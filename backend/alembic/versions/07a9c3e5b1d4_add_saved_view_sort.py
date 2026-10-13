"""add a sort order to saved views

Revision ID: 07a9c3e5b1d4
Revises: f1b4c8d2e605
Create Date: 2026-09-26

Issue #88, part 1: a saved view remembers how its list was sorted. Both
columns are nullable, and null is the default -- newest first -- which is
exactly what every existing view already showed.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "07a9c3e5b1d4"
down_revision: Union[str, Sequence[str], None] = "f1b4c8d2e605"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_SORTS = ("created", "updated", "priority", "estimate", "title")
_DIRECTIONS = ("asc", "desc")


def upgrade() -> None:
    bind = op.get_bind()
    sort = sa.Enum(*_SORTS, name="issuesort")
    direction = sa.Enum(*_DIRECTIONS, name="sortdirection")
    sort.create(bind, checkfirst=True)
    direction.create(bind, checkfirst=True)
    with op.batch_alter_table("savedview", schema=None) as batch_op:
        batch_op.add_column(sa.Column("sort", sort, nullable=True))
        batch_op.add_column(sa.Column("sort_direction", direction, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("savedview", schema=None) as batch_op:
        batch_op.drop_column("sort_direction")
        batch_op.drop_column("sort")
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        postgresql.ENUM(name="sortdirection").drop(bind, checkfirst=True)
        postgresql.ENUM(name="issuesort").drop(bind, checkfirst=True)

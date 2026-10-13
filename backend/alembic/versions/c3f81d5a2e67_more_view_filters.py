"""saved views filter on creator, watching, when and what is missing

Revision ID: c3f81d5a2e67
Revises: a7c2e9d4f160
Create Date: 2026-10-12

Issue #261: a saved view can filter on who created a ticket, on what the
viewer watches, on when a ticket was updated or created, and on a ticket
having no estimate, epic or sprint -- and "me" is a value of the assignee and
creator filters, so a shared "assigned to me" means whoever opens it.

Every new column has a default that asks nothing, so each existing view opens
on the tickets it always did. The downgrade drops them: a view saved with one
of these filters comes back wider than it was.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "c3f81d5a2e67"
down_revision: Union[str, Sequence[str], None] = "a7c2e9d4f160"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_JSON = sa.JSON().with_variant(JSONB(), "postgresql")
_WINDOWS = ("last_7_days", "last_30_days", "over_30_days")
_SWITCHES = ("assignee_me", "creator_me", "creator_exclude", "watching")
_LISTS = ("creator_ids", "has_no")
_DATES = ("updated_from", "updated_to", "created_from", "created_to")
_WINDOW_COLUMNS = ("updated", "created")


def upgrade() -> None:
    bind = op.get_bind()
    window = sa.Enum(*_WINDOWS, name="datewindow")
    # add_column does not emit CREATE TYPE the way create_table does.
    window.create(bind, checkfirst=True)

    with op.batch_alter_table("savedview", schema=None) as batch_op:
        for switch in _SWITCHES:
            batch_op.add_column(
                sa.Column(
                    switch, sa.Boolean(), nullable=False, server_default=sa.false()
                )
            )
        for name in _LISTS:
            batch_op.add_column(
                sa.Column(name, _JSON, nullable=False, server_default="[]")
            )
        for name in _WINDOW_COLUMNS:
            batch_op.add_column(sa.Column(name, window, nullable=True))
        for name in _DATES:
            batch_op.add_column(sa.Column(name, sa.Date(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("savedview", schema=None) as batch_op:
        for name in (*_DATES, *_WINDOW_COLUMNS, *_LISTS, *_SWITCHES):
            batch_op.drop_column(name)

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        postgresql.ENUM(name="datewindow").drop(bind, checkfirst=True)

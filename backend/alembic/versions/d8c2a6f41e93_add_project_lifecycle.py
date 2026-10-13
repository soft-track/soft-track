"""add project lifecycle: a lead, a target date, a state, and archiving

Revision ID: d8c2a6f41e93
Revises: 6b7e8d9f0a12
Create Date: 2026-09-25

Issue #60. A project is SoftTrack's epic, and these are the fields that make
one answerable: who owns it, when it is meant to land, where it has got to,
and whether it is still offered in pickers.

Every existing project comes out `planned`, unarchived, with no lead and no
target date. `planned` is a guess for a project that already has work in
flight, but it is the only state that claims nothing, and a team moves it on
in one click.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "d8c2a6f41e93"
down_revision: Union[str, Sequence[str], None] = "6b7e8d9f0a12"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_STATES = ("planned", "in_progress", "completed", "cancelled")
_LEAD_FK = "fk_project_lead_id_user"


def upgrade() -> None:
    bind = op.get_bind()
    project_state = sa.Enum(*_STATES, name="projectstate")
    # add_column does not emit CREATE TYPE the way create_table does, so on
    # Postgres the type has to exist first. A no-op on SQLite.
    project_state.create(bind, checkfirst=True)

    # server_default for the NOT NULL columns, then dropped in a second batch:
    # existing rows need a value, and SQLite's batch mode rebuilds the table
    # from the columns' *final* definitions -- see 4522806f02f8 for what one
    # batch did to every SQLite install.
    with op.batch_alter_table("project", schema=None) as batch_op:
        batch_op.add_column(sa.Column("lead_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("target_date", sa.Date(), nullable=True))
        batch_op.add_column(
            sa.Column("state", project_state, nullable=False, server_default="planned")
        )
        batch_op.add_column(
            sa.Column(
                "archived", sa.Boolean(), nullable=False, server_default=sa.false()
            )
        )
        batch_op.create_index(
            batch_op.f("ix_project_lead_id"), ["lead_id"], unique=False
        )
        batch_op.create_foreign_key(_LEAD_FK, "user", ["lead_id"], ["id"])

    with op.batch_alter_table("project", schema=None) as batch_op:
        batch_op.alter_column("state", existing_type=project_state, server_default=None)
        batch_op.alter_column(
            "archived", existing_type=sa.Boolean(), server_default=None
        )


def downgrade() -> None:
    with op.batch_alter_table("project", schema=None) as batch_op:
        batch_op.drop_constraint(_LEAD_FK, type_="foreignkey")
        batch_op.drop_index(batch_op.f("ix_project_lead_id"))
        batch_op.drop_column("archived")
        batch_op.drop_column("state")
        batch_op.drop_column("target_date")
        batch_op.drop_column("lead_id")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # Postgres does not drop a type with the column that used it.
        postgresql.ENUM(name="projectstate").drop(bind, checkfirst=True)

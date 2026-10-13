"""sprint goal and retrospective

Revision ID: 275db0819719
Revises: 8ed7f5a5441d
Create Date: 2026-10-04

Issue #271: what a sprint is for (`sprint.goal`), whether that was met
(`sprint.goal_outcome`), and the retrospective -- three markdown sections and
when a team admin closed it. `sprintaction` is a line from "what to change"
that became a ticket. Every column is null for the sprints there are.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # autogenerate emits sqlmodel.sql.sqltypes.AutoString()
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "275db0819719"
down_revision: Union[str, Sequence[str], None] = "8ed7f5a5441d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OUTCOMES = ("met", "partly", "missed")


def upgrade() -> None:
    bind = op.get_bind()
    sprint_outcome = sa.Enum(*_OUTCOMES, name="sprintoutcome")
    # add_column does not emit CREATE TYPE the way create_table does, so on
    # Postgres the type has to exist first. A no-op on SQLite.
    sprint_outcome.create(bind, checkfirst=True)

    with op.batch_alter_table("sprint", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("goal", sqlmodel.sql.sqltypes.AutoString(), nullable=True)
        )
        batch_op.add_column(sa.Column("goal_outcome", sprint_outcome, nullable=True))
        batch_op.add_column(
            sa.Column(
                "retro_went_well", sqlmodel.sql.sqltypes.AutoString(), nullable=True
            )
        )
        batch_op.add_column(
            sa.Column(
                "retro_did_not", sqlmodel.sql.sqltypes.AutoString(), nullable=True
            )
        )
        batch_op.add_column(
            sa.Column(
                "retro_to_change", sqlmodel.sql.sqltypes.AutoString(), nullable=True
            )
        )
        batch_op.add_column(sa.Column("retro_closed_at", sa.DateTime(), nullable=True))

    op.create_table(
        "sprintaction",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sprint_id", sa.Integer(), nullable=False),
        sa.Column("ticket_id", sa.Integer(), nullable=False),
        sa.Column("text", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["sprint_id"], ["sprint.id"], name="fk_sprintaction_sprint_id_sprint"
        ),
        sa.ForeignKeyConstraint(
            ["ticket_id"], ["ticket.id"], name="fk_sprintaction_ticket_id_ticket"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("sprintaction", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_sprintaction_sprint_id"), ["sprint_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_sprintaction_ticket_id"), ["ticket_id"], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table("sprintaction", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_sprintaction_ticket_id"))
        batch_op.drop_index(batch_op.f("ix_sprintaction_sprint_id"))
    op.drop_table("sprintaction")

    with op.batch_alter_table("sprint", schema=None) as batch_op:
        batch_op.drop_column("retro_closed_at")
        batch_op.drop_column("retro_to_change")
        batch_op.drop_column("retro_did_not")
        batch_op.drop_column("retro_went_well")
        batch_op.drop_column("goal_outcome")
        batch_op.drop_column("goal")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # Postgres does not drop a type with the column that used it.
        postgresql.ENUM(name="sprintoutcome").drop(bind, checkfirst=True)

"""add cycles

Revision ID: 4522806f02f8
Revises: 78b80bc56bda
Create Date: 2026-09-07

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # autogenerate emits sqlmodel.sql.sqltypes.AutoString()

revision: str = "4522806f02f8"
down_revision: Union[str, Sequence[str], None] = "78b80bc56bda"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Autogenerate emitted this with `None` for a name, which batch mode on SQLite
# refuses -- it rebuilds the table and has nothing to call the constraint.
_CYCLE_FK = "fk_issue_cycle_id_cycle"


def upgrade() -> None:
    """Add cycles, and the issue and team columns that point at them."""
    op.create_table(
        "cycle",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("starts_at", sa.DateTime(), nullable=False),
        sa.Column("ends_at", sa.DateTime(), nullable=False),
        sa.Column(
            "state",
            sa.Enum("upcoming", "active", "completed", name="cyclestate"),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["team_id"], ["team.id"], name="fk_cycle_team_id_team"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("cycle", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_cycle_state"), ["state"], unique=False)
        batch_op.create_index(batch_op.f("ix_cycle_team_id"), ["team_id"], unique=False)

    with op.batch_alter_table("issue", schema=None) as batch_op:
        # Nullable: an issue not in a cycle is the backlog, which is the normal
        # state for most of them.
        batch_op.add_column(sa.Column("cycle_id", sa.Integer(), nullable=True))
        batch_op.create_index(
            batch_op.f("ix_issue_cycle_id"), ["cycle_id"], unique=False
        )
        batch_op.create_foreign_key(_CYCLE_FK, "cycle", ["cycle_id"], ["id"])

    with op.batch_alter_table("team", schema=None) as batch_op:
        # server_default, then dropped: the column is NOT NULL and existing
        # teams have no value for it, so adding it bare would fail on any
        # database that already has rows. Every existing team starts at 1,
        # which is correct -- none of them has a cycle yet. The default is
        # then removed so the schema matches the model and autogenerate does
        # not keep reporting a difference.
        batch_op.add_column(
            sa.Column(
                "next_cycle_number",
                sa.Integer(),
                nullable=False,
                server_default="1",
            )
        )
        batch_op.alter_column("next_cycle_number", server_default=None)


def downgrade() -> None:
    """Drop cycles, returning every issue to the backlog."""
    with op.batch_alter_table("team", schema=None) as batch_op:
        batch_op.drop_column("next_cycle_number")

    with op.batch_alter_table("issue", schema=None) as batch_op:
        batch_op.drop_constraint(_CYCLE_FK, type_="foreignkey")
        batch_op.drop_index(batch_op.f("ix_issue_cycle_id"))
        batch_op.drop_column("cycle_id")

    with op.batch_alter_table("cycle", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_cycle_team_id"))
        batch_op.drop_index(batch_op.f("ix_cycle_state"))
    op.drop_table("cycle")
    sa.Enum(name="cyclestate").drop(op.get_bind(), checkfirst=True)

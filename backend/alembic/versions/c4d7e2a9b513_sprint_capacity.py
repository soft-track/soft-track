"""sprint capacity

Revision ID: c4d7e2a9b513
Revises: a9c3e5d71f42
Create Date: 2026-10-12

Issue #269: what each person can take in a sprint. A team's default -- ten
points a sprint, six hours a working day -- and, per sprint and person, the
days they are away and a capacity set by hand in either unit.

The downgrade drops the table and the two columns.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "c4d7e2a9b513"
down_revision: Union[str, Sequence[str], None] = "a9c3e5d71f42"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("team", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "capacity_points", sa.Integer(), nullable=False, server_default="10"
            )
        )
        batch_op.add_column(
            sa.Column(
                "capacity_minutes_per_day",
                sa.Integer(),
                nullable=False,
                server_default="360",
            )
        )
    op.create_table(
        "sprintcapacity",
        sa.Column("sprint_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("days_off", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("points", sa.Integer(), nullable=True),
        sa.Column("minutes", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["sprint_id"], ["sprint.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("sprint_id", "user_id"),
    )
    with op.batch_alter_table("sprintcapacity", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_sprintcapacity_user_id"), ["user_id"], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table("sprintcapacity", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_sprintcapacity_user_id"))
    op.drop_table("sprintcapacity")
    with op.batch_alter_table("team", schema=None) as batch_op:
        batch_op.drop_column("capacity_minutes_per_day")
        batch_op.drop_column("capacity_points")

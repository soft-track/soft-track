"""add payroll runs

Revision ID: 0436e0920dca
Revises: 778f8950fc26
Create Date: 2026-09-29

Issue #132: `payrollrun`, one pay period on one pay schedule, and its
`payrollline`s. Nothing to backfill -- no run has ever been generated.

`pay_schedule` reuses the `payschedule` type compensation created in
778f8950fc26. Left to autogenerate, `create_table` would issue a second
CREATE TYPE on Postgres, which fails exactly when this revision runs on its
own against a database already at the previous one: an upgrade. Same trap as
0f0b3f83ea26. Autogenerate's usual offers to drop the FTS5 tables and retype
the trigger columns are left out, as in the revisions before this one.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import sqlmodel  # autogenerate emits sqlmodel.sql.sqltypes.AutoString()

# revision identifiers, used by Alembic.
revision: str = "0436e0920dca"
down_revision: Union[str, Sequence[str], None] = "778f8950fc26"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_SCHEDULES = ("monthly", "semi_monthly", "bi_weekly")


def _pay_schedule():
    """The `payschedule` type compensation already created, referenced."""
    if op.get_bind().dialect.name == "postgresql":
        return postgresql.ENUM(*_SCHEDULES, name="payschedule", create_type=False)
    return sa.Enum(*_SCHEDULES, name="payschedule")


def upgrade() -> None:
    op.create_table(
        "payrollrun",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("pay_schedule", _pay_schedule(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column(
            "state",
            sa.Enum("draft", "approved", "paid", name="payrollrunstate"),
            nullable=False,
        ),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("approved_by_id", sa.Integer(), nullable=True),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column("paid_by_id", sa.Integer(), nullable=True),
        sa.Column("paid_at", sa.DateTime(), nullable=True),
        # Named rather than left to autogenerate's `None`, which batch mode on
        # SQLite refuses when a later revision rebuilds the table.
        sa.ForeignKeyConstraint(
            ["approved_by_id"], ["user.id"], name="fk_payrollrun_approved_by_id_user"
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"], ["user.id"], name="fk_payrollrun_created_by_id_user"
        ),
        sa.ForeignKeyConstraint(
            ["paid_by_id"], ["user.id"], name="fk_payrollrun_paid_by_id_user"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "pay_schedule", "period_start", name="uq_payrollrun_schedule_start"
        ),
    )
    with op.batch_alter_table("payrollrun", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_payrollrun_state"), ["state"], unique=False
        )

    op.create_table(
        "payrollline",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("compensation_id", sa.Integer(), nullable=True),
        sa.Column("amount_minor", sa.Integer(), nullable=True),
        sa.Column("currency", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("adjustment_minor", sa.Integer(), nullable=False),
        sa.Column("adjustment_note", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("department_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["compensation_id"],
            ["compensation.id"],
            name="fk_payrollline_compensation_id_compensation",
        ),
        sa.ForeignKeyConstraint(
            ["department_id"],
            ["department.id"],
            name="fk_payrollline_department_id_department",
        ),
        sa.ForeignKeyConstraint(
            ["run_id"], ["payrollrun.id"], name="fk_payrollline_run_id_payrollrun"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["user.id"], name="fk_payrollline_user_id_user"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "user_id", name="uq_payrollline_run_user"),
    )
    with op.batch_alter_table("payrollline", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_payrollline_run_id"), ["run_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_payrollline_user_id"), ["user_id"], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table("payrollline", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_payrollline_user_id"))
        batch_op.drop_index(batch_op.f("ix_payrollline_run_id"))
    op.drop_table("payrollline")

    with op.batch_alter_table("payrollrun", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_payrollrun_state"))
    op.drop_table("payrollrun")
    # Only this one: `payschedule` is still compensation's.
    sa.Enum(name="payrollrunstate").drop(op.get_bind(), checkfirst=True)

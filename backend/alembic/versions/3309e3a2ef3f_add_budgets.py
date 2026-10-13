"""add budgets

Revision ID: 3309e3a2ef3f
Revises: f82ef312f8cb
Create Date: 2026-09-29

Issue #134: `budget`, what a department meant to spend in a period, in one
currency. One per department, period and currency. The actuals it is
compared with need nothing new: approved payroll lines (#132) and expense
claims (#133) already carry the department they were approved under.
Autogenerate's usual offers to drop the FTS5 tables and retype the trigger
columns are left out, as in the revisions before this one.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # autogenerate emits sqlmodel.sql.sqltypes.AutoString()

# revision identifiers, used by Alembic.
revision: str = "3309e3a2ef3f"
down_revision: Union[str, Sequence[str], None] = "f82ef312f8cb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "budget",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("department_id", sa.Integer(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("amount_minor", sa.Integer(), nullable=False),
        sa.Column("currency", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        # Named rather than left to autogenerate's `None`, which batch mode on
        # SQLite refuses when a later revision rebuilds the table.
        sa.ForeignKeyConstraint(
            ["created_by_id"], ["user.id"], name="fk_budget_created_by_id_user"
        ),
        sa.ForeignKeyConstraint(
            ["department_id"],
            ["department.id"],
            name="fk_budget_department_id_department",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "department_id",
            "currency",
            "period_start",
            "period_end",
            name="uq_budget_department_currency_period",
        ),
    )
    with op.batch_alter_table("budget", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_budget_department_id"), ["department_id"], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table("budget", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_budget_department_id"))
    op.drop_table("budget")

"""add reimbursements

Revision ID: f82ef312f8cb
Revises: 4abad33236f0
Create Date: 2026-09-29

Issue #137: `reimbursementbatch`, and on `expense` the batch or payroll run a
claim is paid back on and when. Nothing to backfill: every approved claim
comes out awaiting reimbursement, which is what it is.

Paid back exactly once is the row's own rule, as two check constraints: a
claim is in a batch or on a run and never both, and only an approved claim is
in either. Autogenerate does not see check constraints, so they are written
here. `state` reuses the `payrollrunstate` type 0436e0920dca created, the
same trap as that revision's `payschedule`. Autogenerate's usual offers to
drop the FTS5 tables and retype the trigger columns are left out, as in the
revisions before this one.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "f82ef312f8cb"
down_revision: Union[str, Sequence[str], None] = "4abad33236f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_STATES = ("draft", "approved", "paid")
_BATCH_FK = "fk_expense_reimbursement_batch_id_reimbursementbatch"
_RUN_FK = "fk_expense_payroll_run_id_payrollrun"


def _run_state():
    """The `payrollrunstate` type payroll runs already created, referenced."""
    if op.get_bind().dialect.name == "postgresql":
        return postgresql.ENUM(*_STATES, name="payrollrunstate", create_type=False)
    return sa.Enum(*_STATES, name="payrollrunstate")


def upgrade() -> None:
    op.create_table(
        "reimbursementbatch",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("state", _run_state(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("approved_by_id", sa.Integer(), nullable=True),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column("paid_by_id", sa.Integer(), nullable=True),
        sa.Column("paid_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["approved_by_id"],
            ["user.id"],
            name="fk_reimbursementbatch_approved_by_id_user",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["user.id"],
            name="fk_reimbursementbatch_created_by_id_user",
        ),
        sa.ForeignKeyConstraint(
            ["paid_by_id"], ["user.id"], name="fk_reimbursementbatch_paid_by_id_user"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("reimbursementbatch", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_reimbursementbatch_state"), ["state"], unique=False
        )

    with op.batch_alter_table("expense", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("reimbursement_batch_id", sa.Integer(), nullable=True)
        )
        batch_op.add_column(sa.Column("payroll_run_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("reimbursed_at", sa.DateTime(), nullable=True))
        batch_op.create_index(
            batch_op.f("ix_expense_payroll_run_id"), ["payroll_run_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_expense_reimbursement_batch_id"),
            ["reimbursement_batch_id"],
            unique=False,
        )
        batch_op.create_foreign_key(_RUN_FK, "payrollrun", ["payroll_run_id"], ["id"])
        batch_op.create_foreign_key(
            _BATCH_FK, "reimbursementbatch", ["reimbursement_batch_id"], ["id"]
        )
        batch_op.create_check_constraint(
            "ck_expense_settled_once",
            "reimbursement_batch_id IS NULL OR payroll_run_id IS NULL",
        )
        batch_op.create_check_constraint(
            "ck_expense_settles_approved",
            "state = 'approved' OR "
            "(reimbursement_batch_id IS NULL AND payroll_run_id IS NULL)",
        )


def downgrade() -> None:
    with op.batch_alter_table("expense", schema=None) as batch_op:
        batch_op.drop_constraint("ck_expense_settles_approved", type_="check")
        batch_op.drop_constraint("ck_expense_settled_once", type_="check")
        batch_op.drop_constraint(_BATCH_FK, type_="foreignkey")
        batch_op.drop_constraint(_RUN_FK, type_="foreignkey")
        batch_op.drop_index(batch_op.f("ix_expense_reimbursement_batch_id"))
        batch_op.drop_index(batch_op.f("ix_expense_payroll_run_id"))
        batch_op.drop_column("reimbursed_at")
        batch_op.drop_column("payroll_run_id")
        batch_op.drop_column("reimbursement_batch_id")

    with op.batch_alter_table("reimbursementbatch", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_reimbursementbatch_state"))
    # `payrollrunstate` stays: payroll runs still use it.
    op.drop_table("reimbursementbatch")

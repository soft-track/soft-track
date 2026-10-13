"""add expense claims

Revision ID: 4abad33236f0
Revises: 0436e0920dca
Create Date: 2026-09-29

Issue #133: `expense`, one claim per row -- who spent what, on which day, a
receipt through the attachment pipeline, and the decision. Nothing to
backfill: nobody has ever claimed anything.

The receipt is columns on the claim rather than an `attachment` row, which
always belongs to a ticket and is guarded by the ticket's team; a receipt is
guarded by who may see money. Autogenerate's usual offers to drop the FTS5
tables and retype the trigger columns are left out, as in the revisions
before this one.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # autogenerate emits sqlmodel.sql.sqltypes.AutoString()

# revision identifiers, used by Alembic.
revision: str = "4abad33236f0"
down_revision: Union[str, Sequence[str], None] = "0436e0920dca"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "expense",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("submitter_id", sa.Integer(), nullable=False),
        sa.Column("amount_minor", sa.Integer(), nullable=False),
        sa.Column("currency", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("incurred_on", sa.Date(), nullable=False),
        sa.Column("description", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column(
            "state",
            sa.Enum("submitted", "approved", "refused", name="expensestate"),
            nullable=False,
        ),
        sa.Column(
            "receipt_filename", sqlmodel.sql.sqltypes.AutoString(), nullable=True
        ),
        sa.Column(
            "receipt_content_type", sqlmodel.sql.sqltypes.AutoString(), nullable=True
        ),
        sa.Column("receipt_size_bytes", sa.Integer(), nullable=True),
        sa.Column(
            "receipt_storage_key", sqlmodel.sql.sqltypes.AutoString(), nullable=True
        ),
        sa.Column("decided_by_id", sa.Integer(), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("refusal_reason", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("department_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        # Named rather than left to autogenerate's `None`, which batch mode on
        # SQLite refuses when a later revision rebuilds the table.
        sa.ForeignKeyConstraint(
            ["decided_by_id"], ["user.id"], name="fk_expense_decided_by_id_user"
        ),
        sa.ForeignKeyConstraint(
            ["department_id"],
            ["department.id"],
            name="fk_expense_department_id_department",
        ),
        sa.ForeignKeyConstraint(
            ["submitter_id"], ["user.id"], name="fk_expense_submitter_id_user"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("expense", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_expense_state"), ["state"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_expense_submitter_id"), ["submitter_id"], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table("expense", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_expense_submitter_id"))
        batch_op.drop_index(batch_op.f("ix_expense_state"))
    op.drop_table("expense")
    sa.Enum(name="expensestate").drop(op.get_bind(), checkfirst=True)

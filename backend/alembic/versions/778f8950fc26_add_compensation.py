"""add compensation

Revision ID: 778f8950fc26
Revises: 042116f2d4de
Create Date: 2026-09-29

Issue #131: `compensation`, an append-only, effective-dated history of what
each person is paid, in the currency it was agreed in. Nothing to backfill:
pay has never been recorded, so every account starts with no record, which
the compensation list and payroll runs show as missing rather than as zero.

`kind` is stored by value, so the type reads hire, raise, correction, other.
`currency` is plain text, validated by the API against lib_finance/money.py,
so adding a currency never needs a migration. Autogenerate's usual offers to
drop the FTS5 tables and retype the trigger columns are left out, as in the
revisions before this one.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # autogenerate emits sqlmodel.sql.sqltypes.AutoString()

# revision identifiers, used by Alembic.
revision: str = "778f8950fc26"
down_revision: Union[str, Sequence[str], None] = "042116f2d4de"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "compensation",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("amount_minor", sa.Integer(), nullable=False),
        sa.Column("currency", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column(
            "pay_schedule",
            sa.Enum("monthly", "semi_monthly", "bi_weekly", name="payschedule"),
            nullable=False,
        ),
        sa.Column("effective_on", sa.Date(), nullable=False),
        sa.Column(
            "kind",
            sa.Enum("hire", "raise", "correction", "other", name="compensationkind"),
            nullable=False,
        ),
        sa.Column("note", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("corrects_id", sa.Integer(), nullable=True),
        sa.Column("recorded_by_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        # Named rather than left to autogenerate's `None`, which batch mode on
        # SQLite refuses when a later revision rebuilds the table.
        sa.ForeignKeyConstraint(
            ["corrects_id"],
            ["compensation.id"],
            name="fk_compensation_corrects_id_compensation",
        ),
        sa.ForeignKeyConstraint(
            ["recorded_by_id"], ["user.id"], name="fk_compensation_recorded_by_id_user"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["user.id"], name="fk_compensation_user_id_user"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("corrects_id", name="uq_compensation_corrects_id"),
    )
    with op.batch_alter_table("compensation", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_compensation_user_id"), ["user_id"], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table("compensation", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_compensation_user_id"))
    op.drop_table("compensation")
    bind = op.get_bind()
    sa.Enum(name="compensationkind").drop(bind, checkfirst=True)
    sa.Enum(name="payschedule").drop(bind, checkfirst=True)

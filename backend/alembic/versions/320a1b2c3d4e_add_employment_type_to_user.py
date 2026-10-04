"""add employment type to user

Revision ID: 320a1b2c3d4e
Revises: 275db0819719
Create Date: 2026-10-04

Issue #320: `user.employment_type`, classifying an account as employee,
contractor, intern, external or service_account. Only employees are on
payroll by default. Defaults to 'employee', with existing external accounts
migrated to 'external'.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "320a1b2c3d4e"
down_revision: Union[str, Sequence[str], None] = "275db0819719"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_EMPLOYMENT_TYPES = ("employee", "contractor", "intern", "external", "service_account")


def upgrade() -> None:
    bind = op.get_bind()
    employment_type = sa.Enum(*_EMPLOYMENT_TYPES, name="employmenttype")
    employment_type.create(bind, checkfirst=True)

    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "employment_type",
                employment_type,
                nullable=False,
                server_default="employee",
            )
        )

    op.execute(
        sa.text("UPDATE \"user\" SET employment_type = 'external' WHERE is_external")
    )


def downgrade() -> None:
    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.drop_column("employment_type")

    bind = op.get_bind()
    employment_type = sa.Enum(*_EMPLOYMENT_TYPES, name="employmenttype")
    employment_type.drop(bind, checkfirst=True)

"""add employment type to user

Revision ID: a9ae2c8b879d
Revises: 275db0819719
Create Date: 2026-10-05

Issue #320: `user.employment_type`, classifying an account as employee,
contractor, intern, or service_account. User.is_external remains the sole
source of truth for access control. Employment type is nullable; NULL behaves
like a normal employee for payroll eligibility. The canonical demo account
is classified as service_account.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "a9ae2c8b879d"
down_revision: Union[str, Sequence[str], None] = "275db0819719"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_EMPLOYMENT_TYPES = ("employee", "contractor", "intern", "service_account")


def upgrade() -> None:
    bind = op.get_bind()
    employment_type = sa.Enum(*_EMPLOYMENT_TYPES, name="employmenttype")
    employment_type.create(bind, checkfirst=True)

    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "employment_type",
                employment_type,
                nullable=True,
            )
        )

    op.execute(
        sa.text(
            "UPDATE \"user\" SET employment_type = 'service_account' WHERE email = 'demo@softtrack.dev'"
        )
    )


def downgrade() -> None:
    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.drop_column("employment_type")

    bind = op.get_bind()
    employment_type = sa.Enum(*_EMPLOYMENT_TYPES, name="employmenttype")
    employment_type.drop(bind, checkfirst=True)

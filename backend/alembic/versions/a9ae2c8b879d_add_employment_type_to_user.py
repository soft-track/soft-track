"""add employment type to user

Revision ID: a9ae2c8b879d
Revises: c4d7e2a9b513
Create Date: 2026-10-05

Issue #320: `user.employment_type`, classifying an account as employee,
contractor, intern, external or service_account (#247's types). It is not an
access-control flag: `user.is_external` stays that, and the two are not
synced. Nullable; an account with no type is on payroll like an employee. The
canonical demo account is classified as service_account.

`instancesettings.payroll_types`: the types finance has put on payroll
besides employees. Empty by default.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a9ae2c8b879d"
down_revision: Union[str, Sequence[str], None] = "c4d7e2a9b513"
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
                nullable=True,
            )
        )

    with op.batch_alter_table("instancesettings", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "payroll_types",
                sa.JSON().with_variant(postgresql.JSONB(), "postgresql"),
                nullable=False,
                server_default="[]",
            )
        )

    op.execute(
        sa.text(
            "UPDATE \"user\" SET employment_type = 'service_account' WHERE email = 'demo@softtrack.dev'"
        )
    )


def downgrade() -> None:
    with op.batch_alter_table("instancesettings", schema=None) as batch_op:
        batch_op.drop_column("payroll_types")

    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.drop_column("employment_type")

    bind = op.get_bind()
    employment_type = sa.Enum(*_EMPLOYMENT_TYPES, name="employmenttype")
    employment_type.drop(bind, checkfirst=True)

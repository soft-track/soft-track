"""add TOTP two-factor authentication columns to user

Revision ID: c2a1b3d45e67
Revises: f4257f8963c4
Create Date: 2026-09-10

Three nullable columns on `user` for TOTP enrolment state. All three default
to NULL / False so the ALTER succeeds on a live database with rows, and every
existing user is treated as having 2FA off -- which is exactly the correct
starting state for an upgrade.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401 -- autogenerate emits sqlmodel.sql.sqltypes.AutoString()

revision: str = "c2a1b3d45e67"
down_revision: Union[str, Sequence[str], None] = "f4257f8963c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("user", schema=None) as batch_op:
        # The TOTP secret is Base32; nullable because it is only written at
        # enrolment-start, and only kept if the user confirms a valid code.
        batch_op.add_column(
            sa.Column(
                "totp_secret",
                sqlmodel.sql.sqltypes.AutoString(),
                nullable=True,
            )
        )
        # totp_enabled is separate from totp_secret so that a half-finished
        # enrolment (secret generated but never confirmed) stays harmless.
        batch_op.add_column(
            sa.Column(
                "totp_enabled",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
        batch_op.add_column(
            sa.Column(
                "totp_pending_secret",
                sqlmodel.sql.sqltypes.AutoString(),
                nullable=True,
            )
        )
        # JSON-encoded list of SHA-256-hashed single-use recovery codes.
        batch_op.add_column(
            sa.Column(
                "totp_recovery_codes",
                sqlmodel.sql.sqltypes.AutoString(),
                nullable=True,
            )
        )
        # Time-step of last verified TOTP to prevent replay attacks.
        batch_op.add_column(
            sa.Column(
                "totp_last_step",
                sa.Integer(),
                nullable=True,
            )
        )

    # Drop the server defaults now that the backfill is done: the model has
    # none, and leaving them causes autogenerate to report a drift forever.
    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.alter_column(
            "totp_enabled", existing_type=sa.Boolean(), server_default=None
        )


def downgrade() -> None:
    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.drop_column("totp_last_step")
        batch_op.drop_column("totp_recovery_codes")
        batch_op.drop_column("totp_enabled")
        batch_op.drop_column("totp_pending_secret")
        batch_op.drop_column("totp_secret")

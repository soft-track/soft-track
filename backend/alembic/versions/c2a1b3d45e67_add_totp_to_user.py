"""add TOTP two-factor authentication columns to user

Revision ID: c2a1b3d45e67
Revises: 6ccd108e66f0
Create Date: 2026-09-10

Five columns on `user` for two-factor state. Four are nullable and
`totp_enabled` is backfilled to false, so the ALTER succeeds on a live database
with rows and every existing user starts with two-factor off -- exactly the
right state for an upgrade.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401 -- autogenerate emits sqlmodel.sql.sqltypes.AutoString()

revision: str = "c2a1b3d45e67"
down_revision: Union[str, Sequence[str], None] = "6ccd108e66f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("user", schema=None) as batch_op:
        # The TOTP secret, encrypted with a key derived from SECRET_KEY. Only
        # written once a setup is confirmed with a valid code.
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
        # A setup in progress: its secret, encrypted the same way.
        batch_op.add_column(
            sa.Column(
                "totp_pending_secret",
                sqlmodel.sql.sqltypes.AutoString(),
                nullable=True,
            )
        )
        # JSON list of HMAC-SHA256 digests of the unused recovery codes.
        batch_op.add_column(
            sa.Column(
                "totp_recovery_codes",
                sqlmodel.sql.sqltypes.AutoString(),
                nullable=True,
            )
        )
        # The time step of the last accepted code, so it cannot be accepted again.
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

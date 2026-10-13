"""notification preferences, kind by kind, and muted teams

Revision ID: b5d1e7a3c942
Revises: c3f81d5a2e67
Create Date: 2026-10-12

Issue #263: each kind of notification can be switched on or off in the app
and by email, and a team can be muted.

`notificationpreference` holds only the choices people make; no row means the
kind's default, which is what happened before. Each notification remembers
where it may go: `in_app` and `by_email`, both true by default. The digest
used to skip whoever had `user.email_notifications` off; it now reads
`by_email`, so the rows still waiting for a digest are set to match the
switch their person has today.

The downgrade drops the choices and the two columns: everything is back in
the inbox, and the digest goes back to the single switch.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel

# revision identifiers, used by Alembic.
revision: str = "b5d1e7a3c942"
down_revision: Union[str, Sequence[str], None] = "c3f81d5a2e67"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notificationpreference",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("kind", sqlmodel.sql.sqltypes.AutoString(length=40), nullable=False),
        sa.Column(
            "channel", sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False
        ),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("user_id", "kind", "channel"),
    )
    with op.batch_alter_table("notification", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("in_app", sa.Boolean(), nullable=False, server_default=sa.true())
        )
        batch_op.add_column(
            sa.Column(
                "by_email", sa.Boolean(), nullable=False, server_default=sa.true()
            )
        )
    with op.batch_alter_table("teammember", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "notifications_muted",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )

    user = sa.table(
        "user",
        sa.column("id", sa.Integer),
        sa.column("email_notifications", sa.Boolean),
    )
    notification = sa.table(
        "notification",
        sa.column("user_id", sa.Integer),
        sa.column("by_email", sa.Boolean),
        sa.column("emailed_at", sa.DateTime),
    )
    op.execute(
        notification.update()
        .where(
            notification.c.emailed_at.is_(None),
            notification.c.user_id.in_(
                sa.select(user.c.id).where(user.c.email_notifications == sa.false())
            ),
        )
        .values(by_email=False)
    )


def downgrade() -> None:
    with op.batch_alter_table("teammember", schema=None) as batch_op:
        batch_op.drop_column("notifications_muted")
    with op.batch_alter_table("notification", schema=None) as batch_op:
        batch_op.drop_column("by_email")
        batch_op.drop_column("in_app")
    op.drop_table("notificationpreference")

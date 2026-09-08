"""add notifications

Revision ID: 75b841119c61
Revises: b7d3e91a5c04
Create Date: 2026-09-08 14:25:43.353216

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "75b841119c61"
down_revision: Union[str, Sequence[str], None] = "b7d3e91a5c04"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add the watch and notification tables, and the per-user email switch."""
    op.create_table(
        "issuewatch",
        sa.Column("issue_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("watching", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["issue_id"], ["issue.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("issue_id", "user_id"),
    )
    op.create_table(
        "notification",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "kind",
            sa.Enum(
                "assigned",
                "mentioned",
                "commented",
                "status_changed",
                name="notificationkind",
            ),
            nullable=False,
        ),
        sa.Column("issue_id", sa.Integer(), nullable=False),
        sa.Column("comment_id", sa.Integer(), nullable=True),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column("read_at", sa.DateTime(), nullable=True),
        sa.Column("emailed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["actor_id"], ["user.id"]),
        sa.ForeignKeyConstraint(["comment_id"], ["comment.id"]),
        sa.ForeignKeyConstraint(["issue_id"], ["issue.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("notification", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_notification_comment_id"), ["comment_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_notification_created_at"), ["created_at"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_notification_issue_id"), ["issue_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_notification_read_at"), ["read_at"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_notification_user_id"), ["user_id"], unique=False
        )

    # Added with a server default and then without one, the way `is_active`
    # was in b7d3e91a5c04: the column is NOT NULL, so the ALTER needs a value
    # for the accounts already in the table, and afterwards the application
    # supplies it. Autogenerate emits neither half.
    #
    # Existing accounts opt in. The switch only does anything on an instance
    # that has configured SMTP, and an operator who has just done that
    # deliberately did not do it in order to mail nobody.
    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "email_notifications",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            )
        )
    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.alter_column(
            "email_notifications", existing_type=sa.Boolean(), server_default=None
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.drop_column("email_notifications")

    with op.batch_alter_table("notification", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_notification_user_id"))
        batch_op.drop_index(batch_op.f("ix_notification_read_at"))
        batch_op.drop_index(batch_op.f("ix_notification_issue_id"))
        batch_op.drop_index(batch_op.f("ix_notification_created_at"))
        batch_op.drop_index(batch_op.f("ix_notification_comment_id"))

    op.drop_table("notification")
    op.drop_table("issuewatch")
    # Postgres keeps the type after the table using it is gone; SQLite has no
    # such object and `checkfirst` makes this a no-op there.
    sa.Enum(name="notificationkind").drop(op.get_bind(), checkfirst=True)

"""who may create teams

Revision ID: ec512cd840ca
Revises: c5ed33d77db4
Create Date: 2026-10-12

Issue #306: `instancesettings`, one row of settings for the whole instance,
holding who may create a team (`team_creation`, "anyone" -- which is what
creating a team always asked); `teamcreator`, the people named when it is
left to named people; and `teamrequest`, somebody asking for a team.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # autogenerate emits sqlmodel.sql.sqltypes.AutoString()

# revision identifiers, used by Alembic.
revision: str = "ec512cd840ca"
down_revision: Union[str, Sequence[str], None] = "c5ed33d77db4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "instancesettings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "team_creation",
            sa.Enum("anyone", "site_admins", "named_people", name="teamcreationpolicy"),
            nullable=False,
            server_default="anyone",
        ),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "teamcreator",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("added_by_id", sa.Integer(), nullable=False),
        sa.Column("added_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["added_by_id"], ["user.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_table(
        "teamrequest",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("requester_id", sa.Integer(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("key", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("reason", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column(
            "state",
            sa.Enum("pending", "approved", "declined", name="teamrequeststate"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("decided_by_id", sa.Integer(), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("decline_reason", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("team_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["decided_by_id"], ["user.id"]),
        sa.ForeignKeyConstraint(["requester_id"], ["user.id"]),
        sa.ForeignKeyConstraint(["team_id"], ["team.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("teamrequest", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_teamrequest_requester_id"), ["requester_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_teamrequest_state"), ["state"], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table("teamrequest", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_teamrequest_state"))
        batch_op.drop_index(batch_op.f("ix_teamrequest_requester_id"))
    op.drop_table("teamrequest")
    op.drop_table("teamcreator")
    op.drop_table("instancesettings")
    sa.Enum(name="teamrequeststate").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="teamcreationpolicy").drop(op.get_bind(), checkfirst=True)

"""find a team and ask to join it

Revision ID: d4a7c2e9b815
Revises: b7d3e9a41c52
Create Date: 2026-10-12

Issue #259: `team.listed`, whether the team is in the team directory (on, for
every team there is: the directory listed them all before), `team.open_to_join`,
whether anybody signed in joins it without asking (off), and `teamjoinrequest`,
somebody asking to join a team -- one per person per team.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # sqlmodel.sql.sqltypes.AutoString()

# revision identifiers, used by Alembic.
revision: str = "d4a7c2e9b815"
down_revision: Union[str, Sequence[str], None] = "b7d3e9a41c52"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("team", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("listed", sa.Boolean(), nullable=False, server_default=sa.true())
        )
        batch_op.add_column(
            sa.Column(
                "open_to_join", sa.Boolean(), nullable=False, server_default=sa.false()
            )
        )
    op.create_table(
        "teamjoinrequest",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("requester_id", sa.Integer(), nullable=False),
        sa.Column("note", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["requester_id"], ["user.id"]),
        sa.ForeignKeyConstraint(["team_id"], ["team.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "team_id", "requester_id", name="uq_team_join_request_team_requester"
        ),
    )
    with op.batch_alter_table("teamjoinrequest", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_teamjoinrequest_team_id"), ["team_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_teamjoinrequest_requester_id"),
            ["requester_id"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("teamjoinrequest", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_teamjoinrequest_requester_id"))
        batch_op.drop_index(batch_op.f("ix_teamjoinrequest_team_id"))
    op.drop_table("teamjoinrequest")
    with op.batch_alter_table("team", schema=None) as batch_op:
        batch_op.drop_column("open_to_join")
        batch_op.drop_column("listed")

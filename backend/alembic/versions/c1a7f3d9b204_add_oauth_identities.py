"""add oauth identities: signing in with Google or GitHub

Revision ID: c1a7f3d9b204
Revises: f4257f8963c4
Create Date: 2026-09-13

One table. Nothing about existing accounts changes: an install upgraded to this
revision has no provider configured, every user still has the password they
registered with, and `useridentity` stays empty until somebody presses one of
the new buttons.

`hashed_password` is deliberately *not* made nullable. An account created by
signing in with Google gets an unusable marker in it instead -- see
`lib_utils/password.py` -- which keeps every existing reader of that column
correct without a migration that has to rewrite rows.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import sqlmodel  # autogenerate emits sqlmodel.sql.sqltypes.AutoString()

# revision identifiers, used by Alembic.
revision: str = "c1a7f3d9b204"
down_revision: Union[str, Sequence[str], None] = "f4257f8963c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_PROVIDERS = ("google", "github")


def upgrade() -> None:
    op.create_table(
        "useridentity",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        # A genuinely new type, so the generic spelling is right on both
        # backends: Postgres emits CREATE TYPE once, from this create_table,
        # and SQLite compiles it to VARCHAR. Compare f4257f8963c4, where the
        # enum already existed and had to be widened by hand.
        sa.Column(
            "provider", sa.Enum(*_PROVIDERS, name="oauthprovider"), nullable=False
        ),
        sa.Column("subject", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("email", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(), nullable=True),
        # Named rather than left to autogenerate's `None`, which batch mode on
        # SQLite refuses -- it rebuilds the table and has nothing to call the
        # constraint.
        sa.ForeignKeyConstraint(
            ["user_id"], ["user.id"], name="fk_useridentity_user_id_user"
        ),
        sa.PrimaryKeyConstraint("id"),
        # The whole reason this table can be trusted: one provider account
        # signs in as exactly one user, enforced by the database rather than by
        # whichever request got there first -- and one user has at most one
        # account per provider, so "disconnect Google" is never ambiguous.
        sa.UniqueConstraint("provider", "subject", name="uq_user_identity_subject"),
        sa.UniqueConstraint("user_id", "provider", name="uq_user_identity_provider"),
    )
    with op.batch_alter_table("useridentity", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_useridentity_user_id"), ["user_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_useridentity_subject"), ["subject"], unique=False
        )


def downgrade() -> None:
    """Drop the table, and the enum type it brought with it on Postgres."""
    with op.batch_alter_table("useridentity", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_useridentity_subject"))
        batch_op.drop_index(batch_op.f("ix_useridentity_user_id"))
    op.drop_table("useridentity")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # Nothing else uses `oauthprovider`, and Postgres does not drop a type
        # with the table that created it.
        postgresql.ENUM(name="oauthprovider").drop(bind, checkfirst=True)

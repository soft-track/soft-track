"""add saved views

Revision ID: 816a5f43eb02
Revises: 75b841119c61
Create Date: 2026-09-08 15:27:04.683395

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import sqlmodel  # autogenerate emits sqlmodel.sql.sqltypes.AutoString()

# revision identifiers, used by Alembic.
revision: str = "816a5f43eb02"
down_revision: Union[str, Sequence[str], None] = "75b841119c61"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Autogenerate emitted `None` for the name, which batch mode on SQLite refuses
# -- it rebuilds the table and has nothing to call the constraint. Same reason
# as _CYCLE_FK in 4522806f02f8.
_DEFAULT_VIEW_FK = "fk_team_default_view_id_savedview"


def _existing_enum(name: str, *values: str):
    """Reference an enum type the schema already has, without recreating it.

    `savedview.status` and `savedview.priority` reuse the types the initial
    schema created for `issue`. What autogenerate emits -- a bare
    `sa.Enum(..., name="issuestatus")` inside `create_table` -- makes Postgres
    issue CREATE TYPE for a type that is already there.

    The reason this is worth a helper rather than a shrug is *when* it breaks.
    Running the whole chain in one command against an empty database succeeds,
    because SQLAlchemy remembers within a single process that it has already
    emitted that type. So `docker compose up` on a clean machine is green, and
    so is CI. It fails only when this one revision runs on its own against a
    database already at the previous one:

        sqlalchemy.exc.ProgrammingError: (psycopg.errors.DuplicateObject)
        type "issuestatus" already exists

    which is precisely what upgrading an existing SoftTrack does. Verified
    both ways against postgres:16-alpine.

    `create_type=False` says the type is already there. It also keeps the
    downgrade from emitting DROP TYPE, which would be wrong anyway: `issue`
    is still using both of them.

    SQLite has no enum types at all -- it stores these as VARCHAR with a check
    constraint -- so the generic form is right there.
    """
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.ENUM(*values, name=name, create_type=False)
    return sa.Enum(*values, name=name)


def upgrade() -> None:
    """Add saved views, the per-user override, and the team's default."""
    op.create_table(
        "savedview",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("is_shared", sa.Boolean(), nullable=False),
        sa.Column(
            "status",
            _existing_enum(
                "issuestatus",
                "backlog",
                "todo",
                "in_progress",
                "in_review",
                "done",
                "cancelled",
            ),
            nullable=True,
        ),
        sa.Column(
            "priority",
            _existing_enum(
                "issuepriority", "no_priority", "urgent", "high", "medium", "low"
            ),
            nullable=True,
        ),
        sa.Column("assignee_id", sa.Integer(), nullable=True),
        sa.Column("unassigned", sa.Boolean(), nullable=False),
        sa.Column("label_id", sa.Integer(), nullable=True),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("cycle_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["assignee_id"], ["user.id"], name="fk_savedview_assignee_id_user"
        ),
        sa.ForeignKeyConstraint(
            ["cycle_id"], ["cycle.id"], name="fk_savedview_cycle_id_cycle"
        ),
        sa.ForeignKeyConstraint(
            ["label_id"], ["label.id"], name="fk_savedview_label_id_label"
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["user.id"], name="fk_savedview_owner_id_user"
        ),
        sa.ForeignKeyConstraint(
            ["project_id"], ["project.id"], name="fk_savedview_project_id_project"
        ),
        sa.ForeignKeyConstraint(
            ["team_id"], ["team.id"], name="fk_savedview_team_id_team"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("savedview", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_savedview_is_shared"), ["is_shared"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_savedview_owner_id"), ["owner_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_savedview_team_id"), ["team_id"], unique=False
        )

    op.create_table(
        "userdefaultview",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("view_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["team_id"], ["team.id"], name="fk_userdefaultview_team_id_team"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["user.id"], name="fk_userdefaultview_user_id_user"
        ),
        sa.ForeignKeyConstraint(
            ["view_id"], ["savedview.id"], name="fk_userdefaultview_view_id_savedview"
        ),
        sa.PrimaryKeyConstraint("user_id", "team_id"),
    )
    with op.batch_alter_table("userdefaultview", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_userdefaultview_view_id"), ["view_id"], unique=False
        )

    # Nullable, so no server default is needed: a team with no saved views has
    # no default, which is the correct state for every team that exists today.
    with op.batch_alter_table("team", schema=None) as batch_op:
        batch_op.add_column(sa.Column("default_view_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            _DEFAULT_VIEW_FK, "savedview", ["default_view_id"], ["id"]
        )


def downgrade() -> None:
    """Downgrade schema."""
    # The team's reference to savedview goes first, or dropping the table
    # below would be refused for still being pointed at.
    with op.batch_alter_table("team", schema=None) as batch_op:
        batch_op.drop_constraint(_DEFAULT_VIEW_FK, type_="foreignkey")
        batch_op.drop_column("default_view_id")

    with op.batch_alter_table("userdefaultview", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_userdefaultview_view_id"))
    op.drop_table("userdefaultview")

    with op.batch_alter_table("savedview", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_savedview_team_id"))
        batch_op.drop_index(batch_op.f("ix_savedview_owner_id"))
        batch_op.drop_index(batch_op.f("ix_savedview_is_shared"))
    op.drop_table("savedview")
    # No DROP TYPE for issuestatus or issuepriority: `issue` still uses both.

"""add repository integration

Revision ID: f4257f8963c4
Revises: 0f0b3f83ea26
Create Date: 2026-09-08 22:38:28.711383

Two tables -- the repositories a team has connected, and the branches, commits
and pull requests those repositories have linked to issues -- plus three new
values on the `automationtrigger` enum.

The enum is the part autogenerate got wrong, and it is worth reading twice.
What it emitted was a *type change* on `automationrule.trigger` and
`automationrun.trigger`, which is how it sees the difference between a
five-value enum and an eight-value one. On SQLite that is a no-op dressed up as
a table rebuild: the column is plain `VARCHAR(15)` with no check constraint
(SQLAlchemy only emits one when `create_constraint=True`, which the previous
revision did not ask for), and SQLite does not enforce varchar lengths anyway.
On Postgres it is wrong in the other direction -- the type really does
constrain the column, and it has to be widened with `ALTER TYPE ... ADD VALUE`
rather than replaced, because two tables depend on it.

So this migration does the Postgres half explicitly and skips the SQLite half
deliberately, rather than letting batch mode rebuild two tables to change a
declared length nothing reads.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import sqlmodel  # autogenerate emits sqlmodel.sql.sqltypes.AutoString()

# revision identifiers, used by Alembic.
revision: str = "f4257f8963c4"
down_revision: Union[str, Sequence[str], None] = "0f0b3f83ea26"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: The three triggers this revision adds to `automationtrigger`.
_NEW_TRIGGERS = ("branch_created", "pull_request_opened", "pull_request_merged")

_PROVIDERS = ("github", "gitlab")
_KINDS = ("branch", "commit", "pull_request")
_PR_STATES = ("open", "merged", "closed")


def _enum(name: str, *values: str):
    """A new enum type, spelled for whichever backend is running.

    Unlike `_existing_enum` in 0f0b3f83ea26 these three types are genuinely
    new, so the generic form is right on both backends -- Postgres will emit
    CREATE TYPE for each of them exactly once, from the single `create_table`
    that uses it.
    """
    return sa.Enum(*values, name=name)


def upgrade() -> None:
    """Add the repository tables, and widen the automation trigger enum."""
    bind = op.get_bind()

    if bind.dialect.name == "postgresql":
        # IF NOT EXISTS so a partially-applied run can be repeated, and one
        # statement per value because Postgres takes them one at a time.
        # Allowed inside a transaction since Postgres 12 as long as the new
        # values are not *used* in the same transaction -- nothing below
        # writes a rule, so that holds.
        for value in _NEW_TRIGGERS:
            op.execute(
                f"ALTER TYPE automationtrigger ADD VALUE IF NOT EXISTS '{value}'"
            )
    # SQLite: nothing to do. See the module docstring -- the column is an
    # unconstrained VARCHAR and always was.

    op.create_table(
        "repository",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("provider", _enum("gitprovider", *_PROVIDERS), nullable=False),
        sa.Column("full_name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("hook_token", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("secret", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("last_delivery_at", sa.DateTime(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        # Named rather than left to autogenerate's `None`, which batch mode on
        # SQLite refuses -- it rebuilds the table and has nothing to call the
        # constraint.
        sa.ForeignKeyConstraint(
            ["created_by_id"], ["user.id"], name="fk_repository_created_by_id_user"
        ),
        sa.ForeignKeyConstraint(
            ["team_id"], ["team.id"], name="fk_repository_team_id_team"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "team_id", "full_name", name="uq_repository_team_full_name"
        ),
    )
    with op.batch_alter_table("repository", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_repository_hook_token"), ["hook_token"], unique=True
        )
        batch_op.create_index(
            batch_op.f("ix_repository_team_id"), ["team_id"], unique=False
        )

    op.create_table(
        "codelink",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("issue_id", sa.Integer(), nullable=False),
        sa.Column("repository_id", sa.Integer(), nullable=False),
        sa.Column("kind", _enum("codelinkkind", *_KINDS), nullable=False),
        sa.Column("external_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("title", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("url", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("state", _enum("pullrequeststate", *_PR_STATES), nullable=True),
        sa.Column("author_name", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["issue_id"], ["issue.id"], name="fk_codelink_issue_id_issue"
        ),
        sa.ForeignKeyConstraint(
            ["repository_id"],
            ["repository.id"],
            name="fk_codelink_repository_id_repository",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "repository_id", "kind", "external_id", "issue_id", name="uq_code_link"
        ),
    )
    with op.batch_alter_table("codelink", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_codelink_issue_id"), ["issue_id"], unique=False
        )
        batch_op.create_index(batch_op.f("ix_codelink_kind"), ["kind"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_codelink_repository_id"), ["repository_id"], unique=False
        )


def downgrade() -> None:
    """Remove the tables, and the rules that could not work without them."""
    # Before the enum values disappear from the application's vocabulary. A
    # rule triggered by something that can no longer happen is inert, and its
    # runs describe a feature that is gone.
    triggers = ", ".join(f"'{value}'" for value in _NEW_TRIGGERS)
    op.execute(f"DELETE FROM automationrun WHERE trigger IN ({triggers})")
    op.execute(f"DELETE FROM automationrule WHERE trigger IN ({triggers})")

    with op.batch_alter_table("codelink", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_codelink_repository_id"))
        batch_op.drop_index(batch_op.f("ix_codelink_kind"))
        batch_op.drop_index(batch_op.f("ix_codelink_issue_id"))
    op.drop_table("codelink")

    with op.batch_alter_table("repository", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_repository_team_id"))
        batch_op.drop_index(batch_op.f("ix_repository_hook_token"))
    op.drop_table("repository")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # `codelinkkind`, `pullrequeststate` and `gitprovider` were created by
        # the tables above and nothing else uses them, so they go. Postgres
        # does not drop a type when the last table using it is dropped.
        for name in ("codelinkkind", "pullrequeststate", "gitprovider"):
            postgresql.ENUM(name=name).drop(bind, checkfirst=True)

        # The three trigger values stay, and this is the one thing this
        # downgrade cannot undo: Postgres has no ALTER TYPE ... DROP VALUE, and
        # the alternative is recreating `automationtrigger` while two tables
        # depend on it -- a column rewrite on both, to remove three labels
        # nothing references now that the rules using them are gone. Three
        # unused labels on an enum are harmless; a downgrade that rewrites two
        # tables to tidy them is not.

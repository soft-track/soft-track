"""add automation rules

Revision ID: 0f0b3f83ea26
Revises: 5e8190bb6409
Create Date: 2026-09-08 21:53:29.031954

The rules themselves, the log of what they did, and one change to an existing
table: `comment.author_id` becomes nullable, because a comment a rule posts
was written by nobody. See `Comment.author_id` for why that is preferable to
authoring it as whoever happened to trip the rule.

The downgrade is the half worth reading. Making the column NOT NULL again
cannot be done while any of those comments exist, so it deletes them -- and
the inbox rows pointing at them, which hold a foreign key. That is real data
loss, and it is the honest reading of "remove the feature that produced it":
the alternative is a downgrade that fails on any instance where a rule ever
commented, which is every instance where the feature was used.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import sqlmodel  # autogenerate emits sqlmodel.sql.sqltypes.AutoString()

# revision identifiers, used by Alembic.
revision: str = "0f0b3f83ea26"
down_revision: Union[str, Sequence[str], None] = "5e8190bb6409"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TRIGGERS = (
    "issue_created",
    "status_changed",
    "issue_assigned",
    "comment_added",
    "cycle_completed",
)
_PRIORITIES = ("no_priority", "urgent", "high", "medium", "low")


def _existing_enum(name: str, *values: str):
    """Reference an enum type the schema already has, without recreating it.

    Both `if_priority` and `set_priority` reuse the `issuepriority` type the
    initial schema created for `issue`. What autogenerate emits -- a bare
    `sa.Enum(..., name="issuepriority")` inside `create_table` -- makes
    Postgres issue CREATE TYPE for a type that is already there.

    The failure only appears when this revision runs on its own against a
    database already at the previous one, which is precisely what upgrading an
    existing SoftTrack does; running the whole chain in one process is green
    because SQLAlchemy remembers it has emitted the type. Same trap and same
    fix as 816a5f43eb02, whose docstring has the longer version.

    SQLite has no enum types -- it stores these as VARCHAR with a check
    constraint -- so the generic form is right there.
    """
    if op.get_bind().dialect.name == "postgresql":
        return postgresql.ENUM(*values, name=name, create_type=False)
    return sa.Enum(*values, name=name)


def _trigger_type():
    """The new `automationtrigger` type, created once and then referenced.

    Two tables carry this column. Left to `create_table` on Postgres, the
    second one emits a second CREATE TYPE -- deduplicated within one process,
    and so invisible until the day something splits the two statements. Doing
    it explicitly here makes the order a property of the migration rather than
    of how it happens to be run.
    """
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return sa.Enum(*_TRIGGERS, name="automationtrigger")
    kind = postgresql.ENUM(*_TRIGGERS, name="automationtrigger")
    kind.create(bind, checkfirst=True)
    return postgresql.ENUM(*_TRIGGERS, name="automationtrigger", create_type=False)


def upgrade() -> None:
    """Add the rule and run tables, and let a comment have no author."""
    trigger = _trigger_type()

    op.create_table(
        "automationrule",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False),
        sa.Column("trigger", trigger, nullable=False),
        # Conditions.
        sa.Column("if_status_id", sa.Integer(), nullable=True),
        sa.Column(
            "if_priority", _existing_enum("issuepriority", *_PRIORITIES), nullable=True
        ),
        sa.Column("if_label_id", sa.Integer(), nullable=True),
        sa.Column("if_project_id", sa.Integer(), nullable=True),
        sa.Column("if_assignee_id", sa.Integer(), nullable=True),
        sa.Column("if_unassigned", sa.Boolean(), nullable=False),
        # Actions.
        sa.Column("set_status_id", sa.Integer(), nullable=True),
        sa.Column(
            "set_priority", _existing_enum("issuepriority", *_PRIORITIES), nullable=True
        ),
        sa.Column("set_assignee_id", sa.Integer(), nullable=True),
        sa.Column("add_label_id", sa.Integer(), nullable=True),
        sa.Column("set_cycle_id", sa.Integer(), nullable=True),
        sa.Column("move_to_active_cycle", sa.Boolean(), nullable=False),
        sa.Column("comment_body", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        # Named rather than left to autogenerate's `None`, which batch mode on
        # SQLite refuses -- it rebuilds the table and has nothing to call the
        # constraint.
        sa.ForeignKeyConstraint(
            ["add_label_id"], ["label.id"], name="fk_automationrule_add_label_id_label"
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"], ["user.id"], name="fk_automationrule_created_by_id_user"
        ),
        sa.ForeignKeyConstraint(
            ["if_assignee_id"],
            ["user.id"],
            name="fk_automationrule_if_assignee_id_user",
        ),
        sa.ForeignKeyConstraint(
            ["if_label_id"], ["label.id"], name="fk_automationrule_if_label_id_label"
        ),
        sa.ForeignKeyConstraint(
            ["if_project_id"],
            ["project.id"],
            name="fk_automationrule_if_project_id_project",
        ),
        sa.ForeignKeyConstraint(
            ["if_status_id"],
            ["workflowstatus.id"],
            name="fk_automationrule_if_status_id_workflowstatus",
        ),
        sa.ForeignKeyConstraint(
            ["set_assignee_id"],
            ["user.id"],
            name="fk_automationrule_set_assignee_id_user",
        ),
        sa.ForeignKeyConstraint(
            ["set_cycle_id"], ["cycle.id"], name="fk_automationrule_set_cycle_id_cycle"
        ),
        sa.ForeignKeyConstraint(
            ["set_status_id"],
            ["workflowstatus.id"],
            name="fk_automationrule_set_status_id_workflowstatus",
        ),
        sa.ForeignKeyConstraint(
            ["team_id"], ["team.id"], name="fk_automationrule_team_id_team"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("team_id", "name", name="uq_automation_rule_team_name"),
    )
    with op.batch_alter_table("automationrule", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_automationrule_is_enabled"), ["is_enabled"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_automationrule_team_id"), ["team_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_automationrule_trigger"), ["trigger"], unique=False
        )

    op.create_table(
        "automationrun",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("rule_id", sa.Integer(), nullable=True),
        sa.Column("rule_name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("trigger", trigger, nullable=False),
        sa.Column("issue_id", sa.Integer(), nullable=False),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column("summary", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["actor_id"], ["user.id"], name="fk_automationrun_actor_id_user"
        ),
        sa.ForeignKeyConstraint(
            ["issue_id"], ["issue.id"], name="fk_automationrun_issue_id_issue"
        ),
        sa.ForeignKeyConstraint(
            ["rule_id"],
            ["automationrule.id"],
            name="fk_automationrun_rule_id_automationrule",
        ),
        sa.ForeignKeyConstraint(
            ["team_id"], ["team.id"], name="fk_automationrun_team_id_team"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("automationrun", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_automationrun_created_at"), ["created_at"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_automationrun_issue_id"), ["issue_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_automationrun_rule_id"), ["rule_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_automationrun_team_id"), ["team_id"], unique=False
        )

    # Widening a column: nothing to backfill, and every comment that exists
    # today keeps the author it has.
    with op.batch_alter_table("comment", schema=None) as batch_op:
        batch_op.alter_column("author_id", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    """Remove the tables, and the comments that could not exist without them."""
    # Before the column can be NOT NULL again. The inbox rows go first: they
    # hold a foreign key to the comment, and Postgres rejects the delete
    # otherwise.
    op.execute(
        "DELETE FROM notification WHERE comment_id IN "
        "(SELECT id FROM comment WHERE author_id IS NULL)"
    )
    # Attachments too, though a rule never uploads one -- an instance that
    # acquired such a row some other way should not make this fail.
    op.execute(
        "DELETE FROM attachment WHERE comment_id IN "
        "(SELECT id FROM comment WHERE author_id IS NULL)"
    )
    op.execute("DELETE FROM comment WHERE author_id IS NULL")

    with op.batch_alter_table("comment", schema=None) as batch_op:
        batch_op.alter_column("author_id", existing_type=sa.Integer(), nullable=False)

    with op.batch_alter_table("automationrun", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_automationrun_team_id"))
        batch_op.drop_index(batch_op.f("ix_automationrun_rule_id"))
        batch_op.drop_index(batch_op.f("ix_automationrun_issue_id"))
        batch_op.drop_index(batch_op.f("ix_automationrun_created_at"))
    op.drop_table("automationrun")

    with op.batch_alter_table("automationrule", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_automationrule_trigger"))
        batch_op.drop_index(batch_op.f("ix_automationrule_team_id"))
        batch_op.drop_index(batch_op.f("ix_automationrule_is_enabled"))
    op.drop_table("automationrule")

    # Only now, and only this one: `issuepriority` is still in use by `issue`.
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        postgresql.ENUM(name="automationtrigger").drop(bind, checkfirst=True)

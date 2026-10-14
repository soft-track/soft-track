"""test runs

Revision ID: a6e2d8b4c731
Revises: f3c9d1a7e520
Create Date: 2026-10-14

Issue #275: a pass through the test cases. A run is for a release, a sprint
or an epic, in an environment, owned by somebody; its cases are copied in when
it is made, each at the version of its text it is run at, and each gets a
result -- passed, failed, blocked or skipped -- with a note, the step that
failed, files, and the bug a failure raised. A closed run's results are
fixed.

Nothing existing changes. History gets a `test_result` field, added outside
the transaction on Postgres and not at all on SQLite, as before. The
downgrade drops the tables and that history; the label stays on the Postgres
type, which has no DROP VALUE.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401 -- autogenerate emits sqlmodel.sql.sqltypes.AutoString()
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a6e2d8b4c731"
down_revision: Union[str, Sequence[str], None] = "f3c9d1a7e520"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_STATE = sa.Enum("open", "closed", name="testrunstate")
_RESULT = sa.Enum("passed", "failed", "blocked", "skipped", name="testresult")
_TEXT = sqlmodel.sql.sqltypes.AutoString


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.execute(
                "ALTER TYPE ticketeventfield ADD VALUE IF NOT EXISTS 'test_result'"
            )

    op.create_table(
        "testrun",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("name", _TEXT(), nullable=False),
        sa.Column("release_id", sa.Integer(), nullable=True),
        sa.Column("sprint_id", sa.Integer(), nullable=True),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("environment", _TEXT(), nullable=True),
        sa.Column("owner_id", sa.Integer(), nullable=True),
        sa.Column("state", _STATE, nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.Column("closed_by_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["team_id"], ["team.id"]),
        sa.ForeignKeyConstraint(["release_id"], ["release.id"]),
        sa.ForeignKeyConstraint(["sprint_id"], ["sprint.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"]),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"]),
        sa.ForeignKeyConstraint(["created_by_id"], ["user.id"]),
        sa.ForeignKeyConstraint(["closed_by_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("testrun", schema=None) as batch_op:
        for column in ("team_id", "release_id", "sprint_id", "project_id", "state"):
            batch_op.create_index(batch_op.f(f"ix_testrun_{column}"), [column])

    op.create_table(
        "testruncase",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("case_id", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("assignee_id", sa.Integer(), nullable=True),
        sa.Column("result", _RESULT, nullable=True),
        sa.Column("note", _TEXT(), nullable=True),
        sa.Column("failed_step", sa.Integer(), nullable=True),
        sa.Column("ran_by_id", sa.Integer(), nullable=True),
        sa.Column("ran_at", sa.DateTime(), nullable=True),
        sa.Column("bug_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["run_id"], ["testrun.id"]),
        sa.ForeignKeyConstraint(["case_id"], ["testcase.id"]),
        sa.ForeignKeyConstraint(["assignee_id"], ["user.id"]),
        sa.ForeignKeyConstraint(["ran_by_id"], ["user.id"]),
        sa.ForeignKeyConstraint(["bug_id"], ["ticket.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "case_id", name="uq_test_run_case"),
    )
    with op.batch_alter_table("testruncase", schema=None) as batch_op:
        for column in ("run_id", "case_id", "result", "ran_at", "bug_id"):
            batch_op.create_index(batch_op.f(f"ix_testruncase_{column}"), [column])

    op.create_table(
        "testresultfile",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("run_case_id", sa.Integer(), nullable=False),
        sa.Column("filename", _TEXT(), nullable=False),
        sa.Column("content_type", _TEXT(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("storage_key", _TEXT(), nullable=False),
        sa.Column("uploaded_by_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["run_case_id"], ["testruncase.id"]),
        sa.ForeignKeyConstraint(["uploaded_by_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("testresultfile", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_testresultfile_run_case_id"), ["run_case_id"]
        )


def downgrade() -> None:
    op.execute("DELETE FROM ticketevent WHERE field = 'test_result'")
    with op.batch_alter_table("testresultfile", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_testresultfile_run_case_id"))
    op.drop_table("testresultfile")
    with op.batch_alter_table("testruncase", schema=None) as batch_op:
        for column in ("run_id", "case_id", "result", "ran_at", "bug_id"):
            batch_op.drop_index(batch_op.f(f"ix_testruncase_{column}"))
    op.drop_table("testruncase")
    with op.batch_alter_table("testrun", schema=None) as batch_op:
        for column in ("team_id", "release_id", "sprint_id", "project_id", "state"):
            batch_op.drop_index(batch_op.f(f"ix_testrun_{column}"))
    op.drop_table("testrun")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        postgresql.ENUM(name="testresult").drop(bind, checkfirst=True)
        postgresql.ENUM(name="testrunstate").drop(bind, checkfirst=True)

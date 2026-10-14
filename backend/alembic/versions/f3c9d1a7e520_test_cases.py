"""test cases

Revision ID: f3c9d1a7e520
Revises: e8b3c6d2a417
Create Date: 2026-10-14

Issue #274: the test cases a team keeps. A case has a title, preconditions
and numbered steps, an owner and a state, and is numbered per team (TC-21);
folders group cases one level deep, the team's labels cut across them, and a
case lists the tickets it covers. Every change to a case's text is kept as a
version, which a run (#275) will record.

Nothing existing changes: every team starts numbering its cases at 1. The
downgrade drops the tables and the counter.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401 -- autogenerate emits sqlmodel.sql.sqltypes.AutoString()
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "f3c9d1a7e520"
down_revision: Union[str, Sequence[str], None] = "e8b3c6d2a417"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_JSON = sa.JSON().with_variant(JSONB(), "postgresql")
_STATE = sa.Enum("draft", "ready", "retired", name="testcasestate")
_TEXT = sqlmodel.sql.sqltypes.AutoString


def upgrade() -> None:
    with op.batch_alter_table("team", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "next_test_case_number",
                sa.Integer(),
                nullable=False,
                server_default="1",
            )
        )

    op.create_table(
        "testfolder",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("name", _TEXT(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["team_id"], ["team.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("team_id", "name", name="uq_test_folder_team_name"),
    )
    with op.batch_alter_table("testfolder", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_testfolder_team_id"), ["team_id"])

    op.create_table(
        "testcase",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("title", _TEXT(), nullable=False),
        sa.Column("preconditions", _TEXT(), nullable=True),
        sa.Column("steps", _JSON, nullable=False),
        sa.Column("folder_id", sa.Integer(), nullable=True),
        sa.Column("owner_id", sa.Integer(), nullable=True),
        sa.Column("state", _STATE, nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["team_id"], ["team.id"]),
        sa.ForeignKeyConstraint(["folder_id"], ["testfolder.id"]),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"]),
        sa.ForeignKeyConstraint(["created_by_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("testcase", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_testcase_team_id"), ["team_id"])
        batch_op.create_index(batch_op.f("ix_testcase_folder_id"), ["folder_id"])
        batch_op.create_index(batch_op.f("ix_testcase_state"), ["state"])
        batch_op.create_index(
            "ix_testcase_team_number", ["team_id", "number"], unique=True
        )

    op.create_table(
        "testcaseversion",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("case_id", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("title", _TEXT(), nullable=False),
        sa.Column("preconditions", _TEXT(), nullable=True),
        sa.Column("steps", _JSON, nullable=False),
        sa.Column("note", _TEXT(), nullable=True),
        sa.Column("author_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["case_id"], ["testcase.id"]),
        sa.ForeignKeyConstraint(["author_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("case_id", "version", name="uq_test_case_version"),
    )
    with op.batch_alter_table("testcaseversion", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_testcaseversion_case_id"), ["case_id"])

    op.create_table(
        "testcaselabel",
        sa.Column("case_id", sa.Integer(), nullable=False),
        sa.Column("label_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["case_id"], ["testcase.id"]),
        sa.ForeignKeyConstraint(["label_id"], ["label.id"]),
        sa.PrimaryKeyConstraint("case_id", "label_id"),
    )
    with op.batch_alter_table("testcaselabel", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_testcaselabel_label_id"), ["label_id"])

    op.create_table(
        "testcaseticket",
        sa.Column("case_id", sa.Integer(), nullable=False),
        sa.Column("ticket_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["case_id"], ["testcase.id"]),
        sa.ForeignKeyConstraint(["ticket_id"], ["ticket.id"]),
        sa.PrimaryKeyConstraint("case_id", "ticket_id"),
    )
    with op.batch_alter_table("testcaseticket", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_testcaseticket_ticket_id"), ["ticket_id"])


def downgrade() -> None:
    with op.batch_alter_table("testcaseticket", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_testcaseticket_ticket_id"))
    op.drop_table("testcaseticket")
    with op.batch_alter_table("testcaselabel", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_testcaselabel_label_id"))
    op.drop_table("testcaselabel")
    with op.batch_alter_table("testcaseversion", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_testcaseversion_case_id"))
    op.drop_table("testcaseversion")
    with op.batch_alter_table("testcase", schema=None) as batch_op:
        batch_op.drop_index("ix_testcase_team_number")
        batch_op.drop_index(batch_op.f("ix_testcase_state"))
        batch_op.drop_index(batch_op.f("ix_testcase_folder_id"))
        batch_op.drop_index(batch_op.f("ix_testcase_team_id"))
    op.drop_table("testcase")
    with op.batch_alter_table("testfolder", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_testfolder_team_id"))
    op.drop_table("testfolder")
    with op.batch_alter_table("team", schema=None) as batch_op:
        batch_op.drop_column("next_test_case_number")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        postgresql.ENUM(name="testcasestate").drop(bind, checkfirst=True)

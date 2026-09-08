"""add per-team custom statuses

Revision ID: 5e8190bb6409
Revises: 816a5f43eb02
Create Date: 2026-09-08 16:31:12.884210

Turns the fixed `IssueStatus` enum into a row per team per column. Autogenerate
produced the schema half of this and none of the interesting half: every team
needs the default workflow created for it, and every issue, saved view and
history row has to be pointed at the result before the old column can go.

The history conversion is the part to read twice. `issueevent` rows for the
status field stop being status names and become *categories*, which is what
every report reads now -- see `_status_category` in lib_softtrack/history.py.
That is what keeps a chart of the past meaningful after a team renames or
deletes a column, and it is lossy in one direction: `in_progress` and
`in_review` both become `started`, so a cumulative flow diagram of last month
will show one band where it used to show two. The alternative -- recording
status ids -- gives sharper charts that break the first time somebody tidies
up the board.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # autogenerate emits sqlmodel.sql.sqltypes.AutoString()

# revision identifiers, used by Alembic.
revision: str = "5e8190bb6409"
down_revision: Union[str, Sequence[str], None] = "816a5f43eb02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Autogenerate emitted `None` for these names, which batch mode on SQLite
# refuses -- it rebuilds the table and has nothing to call the constraint.
_ISSUE_STATUS_FK = "fk_issue_status_id_workflowstatus"
_VIEW_STATUS_FK = "fk_savedview_status_id_workflowstatus"

#: A frozen copy of DEFAULT_STATUSES in lib_softtrack/tables.py, deliberately
#: not imported. A migration has to keep doing what it did on the day it was
#: written; the live list is free to change afterwards, and this one is what
#: the old enum actually meant.
_DEFAULTS = (
    ("Backlog", "backlog", "#9b98b0"),
    ("Todo", "unstarted", "#6f6c86"),
    ("In Progress", "started", "#f29d0b"),
    ("In Review", "started", "#8b5cf6"),
    ("Done", "done", "#12a474"),
    ("Cancelled", "cancelled", "#f2647d"),
)

#: Old enum value -> the default status now carrying that meaning.
_STATUS_TO_NAME = {
    "backlog": "Backlog",
    "todo": "Todo",
    "in_progress": "In Progress",
    "in_review": "In Review",
    "done": "Done",
    "cancelled": "Cancelled",
}

#: Old enum value -> category, for the history rows.
_STATUS_TO_CATEGORY = {
    "backlog": "backlog",
    "todo": "unstarted",
    "in_progress": "started",
    "in_review": "started",
    "done": "done",
    "cancelled": "cancelled",
}

_CATEGORIES = ("backlog", "unstarted", "started", "done", "cancelled")
_OLD_STATUSES = ("backlog", "todo", "in_progress", "in_review", "done", "cancelled")


def _as_old_status(expression: str) -> str:
    """Cast a text expression back to the old enum type, where there is one.

    Postgres refuses `UPDATE issue SET status = <text>` once `status` is an
    enum column -- "column is of type issuestatus but expression is of type
    text". SQLite stores the enum as VARCHAR and has nothing to cast to, so
    the plain expression is right there. Only the downgrade needs this; every
    write in `upgrade` targets an integer or a varchar.
    """
    if op.get_bind().dialect.name == "postgresql":
        return f"CAST({expression} AS issuestatus)"
    return expression


def _name_case(column: str) -> str:
    """SQL mapping an old status column to a default status name.

    Cast to text first: on Postgres the column is an enum type and will not
    compare to a string literal without it. On SQLite the cast is a no-op.
    """
    whens = " ".join(
        f"WHEN '{value}' THEN '{name}'" for value, name in _STATUS_TO_NAME.items()
    )
    return f"CASE CAST({column} AS VARCHAR) {whens} END"


def upgrade() -> None:
    """Create the workflow tables, give every team the default columns, and
    move every issue, view and history row onto them."""
    op.create_table(
        "workflowstatus",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column(
            "category",
            sa.Enum(*_CATEGORIES, name="statuscategory"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("color", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["team_id"], ["team.id"], name="fk_workflowstatus_team_id_team"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("team_id", "name", name="uq_workflow_status_team_name"),
    )
    with op.batch_alter_table("workflowstatus", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_workflowstatus_category"), ["category"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_workflowstatus_team_id"), ["team_id"], unique=False
        )

    bind = op.get_bind()

    # Every existing team gets exactly the workflow the enum described, so
    # nobody's board looks any different the morning after this runs.
    teams = bind.execute(sa.text("SELECT id FROM team ORDER BY id")).fetchall()
    for (team_id,) in teams:
        for position, (name, category, color) in enumerate(_DEFAULTS):
            bind.execute(
                sa.text(
                    "INSERT INTO workflowstatus"
                    " (team_id, name, category, position, color, created_at)"
                    " VALUES (:team_id, :name, :category, :position, :color,"
                    " '2026-01-01 00:00:00')"
                ),
                {
                    "team_id": team_id,
                    "name": name,
                    "category": category,
                    "position": position,
                    "color": color,
                },
            )

    # --- issues ---------------------------------------------------------
    # Nullable first, because the value has to be computed per row from the
    # column it is replacing.
    with op.batch_alter_table("issue", schema=None) as batch_op:
        batch_op.add_column(sa.Column("status_id", sa.Integer(), nullable=True))

    bind.execute(
        sa.text(
            "UPDATE issue SET status_id = (SELECT ws.id FROM workflowstatus ws"
            " WHERE ws.team_id = issue.team_id"
            f" AND ws.name = {_name_case('issue.status')})"
        )
    )

    with op.batch_alter_table("issue", schema=None) as batch_op:
        batch_op.alter_column("status_id", existing_type=sa.Integer(), nullable=False)
        batch_op.create_index(
            batch_op.f("ix_issue_status_id"), ["status_id"], unique=False
        )
        batch_op.create_foreign_key(
            _ISSUE_STATUS_FK, "workflowstatus", ["status_id"], ["id"]
        )
        batch_op.drop_index(batch_op.f("ix_issue_status"))
        batch_op.drop_column("status")

    # --- saved views ----------------------------------------------------
    with op.batch_alter_table("savedview", schema=None) as batch_op:
        batch_op.add_column(sa.Column("status_id", sa.Integer(), nullable=True))

    bind.execute(
        sa.text(
            "UPDATE savedview SET status_id = (SELECT ws.id FROM workflowstatus ws"
            " WHERE ws.team_id = savedview.team_id"
            f" AND ws.name = {_name_case('savedview.status')})"
            " WHERE savedview.status IS NOT NULL"
        )
    )

    with op.batch_alter_table("savedview", schema=None) as batch_op:
        batch_op.create_foreign_key(
            _VIEW_STATUS_FK, "workflowstatus", ["status_id"], ["id"]
        )
        batch_op.drop_column("status")

    # --- history --------------------------------------------------------
    # Status events become categories. See the module docstring for what this
    # costs and why it is the right trade.
    for value, category in _STATUS_TO_CATEGORY.items():
        for column in ("old_value", "new_value"):
            bind.execute(
                sa.text(
                    f"UPDATE issueevent SET {column} = :category"
                    " WHERE CAST(field AS VARCHAR) = 'status'"
                    f" AND {column} = :value"
                ),
                {"category": category, "value": value},
            )

    # Nothing uses the old type once both columns are gone. Postgres keeps it
    # otherwise; SQLite has no such object and `checkfirst` makes this a no-op.
    sa.Enum(name="issuestatus").drop(bind, checkfirst=True)


def downgrade() -> None:
    """Put the fixed enum back.

    Lossy, and not fixable: several columns can share a category, so anything
    a team added lands on the one default status for its category and the
    issues in it come with. `started` becomes `in_progress`, which means an
    issue that was in review comes back in progress.
    """
    bind = op.get_bind()
    old_status = sa.Enum(*_OLD_STATUSES, name="issuestatus")
    old_status.create(bind, checkfirst=True)

    category_to_status = {
        "backlog": "backlog",
        "unstarted": "todo",
        "started": "in_progress",
        "done": "done",
        "cancelled": "cancelled",
    }
    whens = " ".join(
        f"WHEN '{category}' THEN '{value}'"
        for category, value in category_to_status.items()
    )

    with op.batch_alter_table("issue", schema=None) as batch_op:
        batch_op.add_column(sa.Column("status", old_status, nullable=True))
    issue_status = _as_old_status(
        f"(SELECT CASE CAST(ws.category AS VARCHAR) {whens} END"
        " FROM workflowstatus ws WHERE ws.id = issue.status_id)"
    )
    bind.execute(sa.text(f"UPDATE issue SET status = {issue_status}"))
    with op.batch_alter_table("issue", schema=None) as batch_op:
        batch_op.alter_column("status", existing_type=old_status, nullable=False)
        batch_op.create_index(batch_op.f("ix_issue_status"), ["status"], unique=False)
        batch_op.drop_constraint(_ISSUE_STATUS_FK, type_="foreignkey")
        batch_op.drop_index(batch_op.f("ix_issue_status_id"))
        batch_op.drop_column("status_id")

    with op.batch_alter_table("savedview", schema=None) as batch_op:
        batch_op.add_column(sa.Column("status", old_status, nullable=True))
    view_status = _as_old_status(
        f"(SELECT CASE CAST(ws.category AS VARCHAR) {whens} END"
        " FROM workflowstatus ws WHERE ws.id = savedview.status_id)"
    )
    bind.execute(
        sa.text(
            f"UPDATE savedview SET status = {view_status}"
            " WHERE savedview.status_id IS NOT NULL"
        )
    )
    with op.batch_alter_table("savedview", schema=None) as batch_op:
        batch_op.drop_constraint(_VIEW_STATUS_FK, type_="foreignkey")
        batch_op.drop_column("status_id")

    for category, value in category_to_status.items():
        for column in ("old_value", "new_value"):
            bind.execute(
                sa.text(
                    f"UPDATE issueevent SET {column} = :value"
                    " WHERE CAST(field AS VARCHAR) = 'status'"
                    f" AND {column} = :category"
                ),
                {"value": value, "category": category},
            )

    with op.batch_alter_table("workflowstatus", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_workflowstatus_team_id"))
        batch_op.drop_index(batch_op.f("ix_workflowstatus_category"))
    op.drop_table("workflowstatus")
    sa.Enum(name="statuscategory").drop(bind, checkfirst=True)

"""The issue-templates migration (#97): a new table, on and off cleanly."""

import sqlite3

from alembic import command
from alembic.config import Config

BEFORE = "4b9d2e7a1c85"
AFTER = "6e2a9c4f7d10"


def test_the_table_takes_a_template_and_comes_off_cleanly(tmp_path):
    from sqlmodel import Session, create_engine, select

    from lib_softtrack.tables import IssueTemplate

    db_path = tmp_path / "templates.db"
    config = Config("alembic.ini")
    config.set_main_option("script_location", "alembic")
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    command.upgrade(config, BEFORE)
    connection = sqlite3.connect(db_path)
    connection.execute(
        "INSERT INTO team (id, name, key, next_issue_number, next_cycle_number,"
        " created_at) VALUES (1, 'Engineering', 'ENG', 1, 1, '2026-01-01 00:00:00')"
    )
    connection.commit()
    connection.close()
    command.upgrade(config, AFTER)

    engine = create_engine(f"sqlite:///{db_path}")
    with Session(engine) as session:
        session.add(IssueTemplate(team_id=1, name="Bug report", body="## Steps"))
        session.commit()
        assert session.exec(select(IssueTemplate.name)).all() == ["Bug report"]
    engine.dispose()

    command.downgrade(config, BEFORE)
    connection = sqlite3.connect(db_path)
    tables = {r[0] for r in connection.execute("SELECT name FROM sqlite_master")}
    connection.close()
    assert "issuetemplate" not in tables
    command.upgrade(config, AFTER)

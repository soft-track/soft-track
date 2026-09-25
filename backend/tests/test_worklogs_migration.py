"""The worklogs migration (#102): a new table, on and off cleanly."""

import sqlite3
from datetime import date

from alembic import command
from alembic.config import Config

BEFORE = "9d3f6b1e8a24"
AFTER = "2a7c5e9b4f16"


def test_the_table_takes_an_entry_and_comes_off_cleanly(tmp_path):
    from sqlmodel import Session, create_engine, select

    from lib_softtrack.tables import Worklog

    db_path = tmp_path / "worklogs.db"
    config = Config("alembic.ini")
    config.set_main_option("script_location", "alembic")
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    command.upgrade(config, BEFORE)
    connection = sqlite3.connect(db_path)
    connection.executescript(
        "INSERT INTO team (id, name, key, next_issue_number, next_cycle_number,"
        " created_at) VALUES (1, 'E', 'ENG', 2, 1, '2026-01-01');"
        "INSERT INTO user (id, email, username, hashed_password, full_name,"
        " avatar_color, is_active, is_site_admin, token_version,"
        " email_notifications, created_at) VALUES (1, 'a@b.c', 'a', 'x', 'A',"
        " '#fff', 1, 0, 0, 1, '2026-01-01');"
        "INSERT INTO workflowstatus (id, team_id, name, category, position, color,"
        " created_at) VALUES (1, 1, 'Todo', 'unstarted', 0, '#888', '2026-01-01');"
        "INSERT INTO issue (id, team_id, number, title, status_id, priority, type,"
        " rank, creator_id, created_at, updated_at) VALUES (1, 1, 1, 'W', 1,"
        " 'no_priority', 'task', 'a0', 1, '2026-01-01', '2026-01-01');"
    )
    connection.commit()
    connection.close()
    command.upgrade(config, AFTER)

    engine = create_engine(f"sqlite:///{db_path}")
    with Session(engine) as session:
        session.add(
            Worklog(issue_id=1, user_id=1, minutes=90, worked_on=date(2026, 9, 1))
        )
        session.commit()
        assert session.exec(select(Worklog.minutes)).all() == [90]
    engine.dispose()

    command.downgrade(config, BEFORE)
    connection = sqlite3.connect(db_path)
    tables = {r[0] for r in connection.execute("SELECT name FROM sqlite_master")}
    issues = connection.execute("SELECT count(*) FROM issue").fetchone()[0]
    connection.close()
    assert "worklog" not in tables and issues == 1
    command.upgrade(config, AFTER)

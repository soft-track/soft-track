"""The comment-reactions migration (#96), against a database with a comment in it.

A new table touching no existing rows, so the risk is small and specific: that
the table the migration builds is the one the model expects, and that it comes
off cleanly. The Postgres half -- the `reactionemoji` type being created by
the table and dropped by the downgrade -- was checked by hand against
postgres:16-alpine.
"""

import sqlite3

from alembic import command
from alembic.config import Config

BEFORE = "8c4e1a7d2f93"
AFTER = "4b9d2e7a1c85"


def _config(db_path) -> Config:
    config = Config("alembic.ini")
    config.set_main_option("script_location", "alembic")
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    return config


def _seed(db_path):
    connection = sqlite3.connect(db_path)
    connection.execute(
        "INSERT INTO team (id, name, key, next_issue_number, next_cycle_number,"
        " created_at) VALUES (1, 'Engineering', 'ENG', 2, 1, '2026-01-01 00:00:00')"
    )
    connection.execute(
        "INSERT INTO user (id, email, username, hashed_password, full_name,"
        " avatar_color, is_active, is_site_admin, token_version,"
        " email_notifications, created_at) VALUES (1, 'a@b.c', 'a', 'x', 'A',"
        " '#6366f1', 1, 0, 0, 1, '2026-01-01 00:00:00')"
    )
    connection.execute(
        "INSERT INTO workflowstatus (id, team_id, name, category, position, color,"
        " created_at) VALUES (1, 1, 'Todo', 'unstarted', 0, '#888888',"
        " '2026-01-01 00:00:00')"
    )
    connection.execute(
        "INSERT INTO issue (id, team_id, number, title, status_id, priority,"
        " type, rank, creator_id, created_at, updated_at) VALUES (1, 1, 1,"
        " 'Work', 1, 'no_priority', 'task', 'a0', 1, '2026-01-01 00:00:00',"
        " '2026-01-01 00:00:00')"
    )
    connection.execute(
        "INSERT INTO comment (id, issue_id, author_id, body, created_at)"
        " VALUES (1, 1, 1, 'Looks right', '2026-01-01 00:00:00')"
    )
    connection.commit()
    connection.close()


def test_the_table_takes_a_reaction_and_comes_off_cleanly(tmp_path):
    from sqlmodel import Session, create_engine, select

    from lib_softtrack.tables import CommentReaction, ReactionEmoji

    db_path = tmp_path / "reactions.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)
    _seed(db_path)
    command.upgrade(config, AFTER)
    # The rest of the way before writing through the models: a flush reads the
    # comment a reaction is on, with every column today's `Comment` has
    # (`edited_at`, #93) -- columns this revision predates. Nothing after it
    # touches `commentreaction`, so the table checked is still this one's.
    command.upgrade(config, "head")

    # Written through the model, so a column the migration named differently
    # from the table class would fail here rather than in production.
    engine = create_engine(f"sqlite:///{db_path}")
    with Session(engine) as session:
        session.add(CommentReaction(comment_id=1, user_id=1, emoji=ReactionEmoji.heart))
        session.commit()
        [row] = session.exec(select(CommentReaction)).all()
        assert row.emoji == ReactionEmoji.heart
    engine.dispose()

    command.downgrade(config, BEFORE)
    connection = sqlite3.connect(db_path)
    tables = {r[0] for r in connection.execute("SELECT name FROM sqlite_master")}
    comments = connection.execute("SELECT body FROM comment").fetchall()
    connection.close()
    assert "commentreaction" not in tables
    assert comments == [("Looks right",)]

    command.upgrade(config, AFTER)

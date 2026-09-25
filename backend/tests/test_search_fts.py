"""SQLite search through FTS5 (issue #85).

tests/test_search.py pins the contract every dialect keeps -- tenancy,
attribution, snippets, paging -- and now runs on this path. These pin what
FTS5 adds or risks: stemming, ranking, hostile input, the index keeping up
with edits, and the migration that builds it.
"""

import sqlite3
from datetime import datetime, timedelta, timezone

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlmodel import SQLModel, create_engine

from lib_softtrack.search import _fts_ready
from lib_softtrack.search_fts import OBJECTS
from lib_softtrack.tables import Issue


def make_issue(client, team, title, description=None):
    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": title, "description": description},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def comment(client, team, issue, body):
    response = client.post(
        f"/issues/{issue['id']}/comments", json={"body": body}, headers=team["headers"]
    )
    assert response.status_code == 200, response.text


def search(client, team, q):
    response = client.get("/search", params={"q": q}, headers=team["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def titles(page):
    return [hit["title"] for hit in page["items"]]


def test_the_suite_is_on_the_fts5_path(session):
    """Otherwise every other search test would be quietly testing LIKE."""
    assert _fts_ready(session)


# --- what FTS5 adds ------------------------------------------------------------


def test_a_word_finds_its_other_forms(client, team):
    """Porter stemming, as Postgres's english configuration does."""
    make_issue(client, team, "Opaque", "The websocket keeps connecting and dropping")
    assert titles(search(client, team, "connection")) == ["Opaque"]
    assert titles(search(client, team, "connected")) == ["Opaque"]


def test_a_comment_found_by_stem_is_the_one_quoted(client, team):
    issue = make_issue(client, team, "Opaque", "Nothing here")
    comment(client, team, issue, "Connection refused on port 5432")

    [hit] = search(client, team, "connecting")["items"]
    # Found by stem, so the substring check that attributes a hit cannot
    # see it -- but the comment it came from is still the one quoted.
    assert "Connection refused" in hit["snippet"]


def test_accents_do_not_matter(client, team):
    make_issue(client, team, "Café menu is wrong")
    assert titles(search(client, team, "cafe")) == ["Café menu is wrong"]


def test_relevance_beats_recency(client, team, session):
    """bm25(): an issue about the word outranks one that mentions it once in
    passing, even when the passing mention is newer."""
    focused = make_issue(client, team, "Billing billing invoices")
    passing = make_issue(
        client,
        team,
        "Quarterly planning",
        "A long note about many things, roadmaps, hiring, offsites, and billing "
        "somewhere near the end of a paragraph that goes on for quite a while.",
    )
    # Make the passing mention the most recently touched of the two.
    older = datetime.now(timezone.utc) - timedelta(days=30)
    row = session.get(Issue, focused["id"])
    row.updated_at = older
    session.add(row)
    session.commit()

    assert titles(search(client, team, "billing")) == [
        focused["title"],
        passing["title"],
    ]


def test_every_word_must_appear_in_any_order(client, team):
    make_issue(client, team, "Rate limit the auth endpoints")
    make_issue(client, team, "Rate cards for sales")
    assert titles(search(client, team, "auth rate")) == [
        "Rate limit the auth endpoints"
    ]


@pytest.mark.parametrize(
    "hostile",
    [
        '"foo AND bar',
        "NEAR(",
        "*",
        "-x",
        "title:secret",
        '"',
        "foo OR",
        "NOT",
        "'; DROP TABLE issue; --",
        "a^b",
        "(((",
    ],
)
def test_fts5_syntax_in_the_query_is_just_text(client, team, hostile):
    """Raw FTS5 grammar raises on input like this; none of it may 500."""
    make_issue(client, team, "Harmless")
    response = client.get("/search", params={"q": hostile}, headers=team["headers"])
    assert response.status_code == 200, response.text


def test_a_query_with_no_words_matches_nothing(client, team):
    make_issue(client, team, "Anything")
    page = search(client, team, "!!! ???")
    assert page == {"items": [], "total": 0, "limit": page["limit"], "offset": 0}


def test_a_quoted_word_is_still_found(client, team):
    make_issue(client, team, 'The "deadline" field is ignored')
    assert titles(search(client, team, '"deadline"')) == [
        'The "deadline" field is ignored'
    ]


# --- the index follows the rows -----------------------------------------------


def test_editing_an_issue_moves_it_in_the_index(client, team):
    issue = make_issue(client, team, "Old wording")
    client.patch(
        f"/issues/{issue['id']}",
        json={"title": "New phrasing"},
        headers=team["headers"],
    )
    assert search(client, team, "wording")["items"] == []
    assert titles(search(client, team, "phrasing")) == ["New phrasing"]


def test_a_deleted_issue_and_its_comments_leave_the_index(client, team, session):
    issue = make_issue(client, team, "Doomed issue")
    comment(client, team, issue, "Mentions zeppelins")
    client.delete(f"/issues/{issue['id']}", headers=team["headers"])

    assert search(client, team, "doomed")["items"] == []
    assert search(client, team, "zeppelins")["items"] == []
    # Nothing left in the index to find -- not merely filtered out.
    for table in ("issue_fts", "comment_fts"):
        found = session.exec(
            text(
                f"SELECT count(*) FROM {table} WHERE {table} MATCH 'doomed OR zeppelins'"
            )
        ).one()[0]
        assert found == 0


def test_without_fts5_search_falls_back_to_like(client, team, session):
    """A SQLite built without FTS5 keeps working, on substring matching."""
    for name, kind in OBJECTS.items():
        session.exec(text(f"DROP {kind.upper()} IF EXISTS {name}"))
    session.commit()

    make_issue(client, team, "Deployment checklist")
    # LIKE matches a fragment, which FTS5 would not.
    assert titles(search(client, team, "ployment check")) == ["Deployment checklist"]


# --- the migration ------------------------------------------------------------

BEFORE = "d3a8b1c5e270"
AFTER = "5b8e2d4c9a17"


def _config(db_path) -> Config:
    config = Config("alembic.ini")
    config.set_main_option("script_location", "alembic")
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    return config


def _schema(db_path) -> dict[str, str]:
    """name -> normalised SQL for every FTS object in a database."""
    connection = sqlite3.connect(db_path)
    rows = connection.execute(
        "SELECT name, sql FROM sqlite_master WHERE name IN ({})".format(
            ",".join("?" * len(OBJECTS))
        ),
        list(OBJECTS),
    ).fetchall()
    connection.close()
    return {name: " ".join(sql.split()) for name, sql in rows}


@pytest.fixture
def upgraded(tmp_path):
    """Issues and a comment written before the index existed, then upgraded."""
    db_path = tmp_path / "fts.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)

    connection = sqlite3.connect(db_path)
    stamp = "'2026-01-01 00:00:00'"
    connection.execute(
        "INSERT INTO team (id, name, key, next_issue_number, next_cycle_number,"
        f" created_at) VALUES (1, 'Engineering', 'ENG', 3, 1, {stamp})"
    )
    connection.execute(
        "INSERT INTO user (id, email, username, hashed_password, full_name,"
        " avatar_color, is_active, is_site_admin, token_version,"
        " email_notifications, created_at) VALUES (1, 'a@b.c', 'a', 'x', 'A',"
        f" '#6366f1', 1, 0, 0, 1, {stamp})"
    )
    connection.execute(
        "INSERT INTO workflowstatus (id, team_id, name, category, position,"
        f" color, created_at) VALUES (1, 1, 'Todo', 'unstarted', 0, '#888', {stamp})"
    )
    for number, title in ((1, "Legacy connection notes"), (2, "Unrelated")):
        connection.execute(
            "INSERT INTO issue (id, team_id, number, title, status_id, priority,"
            f" creator_id, created_at, updated_at) VALUES (?, 1, ?, ?, 1,"
            f" 'no_priority', 1, {stamp}, {stamp})",
            (number, number, title),
        )
    connection.execute(
        "INSERT INTO comment (id, issue_id, author_id, body, created_at)"
        f" VALUES (1, 2, 1, 'An old comment about zeppelins', {stamp})"
    )
    connection.commit()
    connection.close()

    command.upgrade(config, AFTER)
    return db_path, config


def _match(db_path, table, query) -> list[int]:
    connection = sqlite3.connect(db_path)
    rows = connection.execute(
        f"SELECT rowid FROM {table} WHERE {table} MATCH ?", (query,)
    ).fetchall()
    connection.close()
    return [row[0] for row in rows]


def test_the_migration_indexes_what_was_already_there(upgraded):
    db_path, _ = upgraded
    assert _match(db_path, "issue_fts", "connected") == [1]
    assert _match(db_path, "comment_fts", "zeppelins") == [1]


def test_every_trigger_survives_every_migration(tmp_path):
    """The trap: a later SQLite batch migration on `issue` or `comment`
    rebuilds the table and drops its triggers, and the index silently stops
    following edits. This fails if any migration up to head does that."""
    db_path = tmp_path / "head.db"
    command.upgrade(_config(db_path), "head")
    assert set(_schema(db_path)) == set(OBJECTS)


def test_every_trigger_survives_stepping_back_down_to_the_index(tmp_path):
    """The same trap on the way down: a downgrade that drops a column from
    `issue` or `comment` rebuilds the table on SQLite, and must put the
    triggers back."""
    db_path = tmp_path / "down.db"
    config = _config(db_path)
    command.upgrade(config, "head")
    command.downgrade(config, AFTER)
    assert set(_schema(db_path)) == set(OBJECTS)


def test_the_migration_and_create_all_build_the_same_index(tmp_path, upgraded):
    """The suite builds its schema with create_all; real databases with the
    migration. If the two drift, the suite tests an index nobody runs."""
    migrated, _ = upgraded
    created = tmp_path / "created.db"
    SQLModel.metadata.create_all(create_engine(f"sqlite:///{created}"))
    assert _schema(created) == _schema(migrated)


def test_a_rollback_removes_the_index_and_keeps_the_rows(upgraded):
    db_path, config = upgraded
    command.downgrade(config, BEFORE)
    assert _schema(db_path) == {}
    connection = sqlite3.connect(db_path)
    issues = connection.execute("SELECT count(*) FROM issue").fetchone()[0]
    connection.close()
    assert issues == 2

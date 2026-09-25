"""Manual card order on the board (issue #88, part 2).

A move writes one row -- the moved card's key -- and every other card keeps
its key. These pin that, the placement rules, and the migration that gives
every existing issue a key without anything visibly moving.
"""

import itertools
import sqlite3

from alembic import command
from alembic.config import Config
from sqlmodel import select

from lib_softtrack.tables import Issue, IssueEvent, IssueEventField
from lib_utils.ranking import keys_in_order


def make_issue(client, team, title, **fields):
    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": title, **fields},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def board(client, team, **params):
    response = client.get(
        f"/teams/{team['team']['id']}/issues",
        params={"sort": "rank", "direction": "asc", **params},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return [issue["title"] for issue in response.json()["items"]]


def move(client, team, issue, expect=200, **placement):
    response = client.post(
        f"/issues/{issue['id']}/move", json=placement, headers=team["headers"]
    )
    assert response.status_code == expect, response.text
    return response.json()


def ranks(client, team):
    response = client.get(
        f"/teams/{team['team']['id']}/issues", headers=team["headers"]
    ).json()["items"]
    return {issue["title"]: issue["rank"] for issue in response}


def test_a_new_issue_goes_on_top(client, team):
    for title in "ABC":
        make_issue(client, team, title)
    assert board(client, team) == ["C", "B", "A"]


def test_a_move_rewrites_only_the_moved_card(client, team):
    a, b, c = (make_issue(client, team, title) for title in "ABC")
    before = ranks(client, team)

    # Drop A between C (above) and B (below).
    moved = move(client, team, a, above_id=c["id"], below_id=b["id"])
    assert board(client, team) == ["C", "A", "B"]

    after = ranks(client, team)
    assert after["B"] == before["B"] and after["C"] == before["C"]
    assert moved["rank"] == after["A"] != before["A"]


def test_to_the_top_and_to_the_bottom(client, team):
    a, b, c = (make_issue(client, team, title) for title in "ABC")
    move(client, team, a, below_id=c["id"])
    assert board(client, team) == ["A", "C", "B"]
    move(client, team, a, above_id=b["id"])
    assert board(client, team) == ["C", "B", "A"]


def test_with_no_neighbours_it_goes_on_top(client, team):
    """An empty column: nothing to be between."""
    a, _ = make_issue(client, team, "A"), make_issue(client, team, "B")
    move(client, team, a)
    assert board(client, team) == ["A", "B"]


def test_into_another_column_changes_status_through_the_usual_path(
    client, team, session
):
    a = make_issue(client, team, "A")
    done = make_issue(
        client, team, "Done already", status_id=team["status_ids"]["Done"]
    )
    moved = move(
        client, team, a, status_id=team["status_ids"]["Done"], below_id=done["id"]
    )

    assert moved["status"]["id"] == team["status_ids"]["Done"]
    assert board(client, team, status_id=team["status_ids"]["Done"]) == [
        "A",
        "Done already",
    ]
    # History, as for any other status change.
    session.expire_all()
    fields = session.exec(
        select(IssueEvent.field).where(
            IssueEvent.issue_id == a["id"], IssueEvent.opening == False  # noqa: E712
        )
    ).all()
    assert IssueEventField.status in fields


def test_a_neighbour_must_be_on_the_team_and_not_the_card(client, team, auth):
    a = make_issue(client, team, "A")
    assert move(client, team, a, expect=400, above_id=a["id"])["code"] == (
        "rank_neighbour_is_self"
    )
    assert move(client, team, a, expect=404, below_id=999999)["code"] == (
        "issue_not_found"
    )


def test_tied_keys_are_repaired_rather_than_refused(client, team, session):
    """Two cards with one key leave no key between them; the team is
    renumbered in its current order and the move goes ahead."""
    a, b, c = (make_issue(client, team, title) for title in "ABC")
    for issue_id in (b["id"], c["id"]):
        row = session.get(Issue, issue_id)
        row.rank = "a5"
        session.add(row)
    session.commit()

    move(client, team, a, above_id=c["id"], below_id=b["id"])
    order = board(client, team)
    assert order.index("C") < order.index("A") < order.index("B")
    assert len(set(ranks(client, team).values())) == 3


def test_imported_issues_get_keys_too(client, team):
    export = (
        "Summary,Issue key,Status,Priority\n"
        "First,J-1,To Do,High\n"
        "Second,J-2,To Do,Low\n"
        "Third,J-3,Done,Low\n"
    )
    response = client.post(
        f"/teams/{team['team']['id']}/import/jira",
        files={"file": ("jira.csv", export.encode(), "text/csv")},
        data={"dry_run": "false"},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    keys = list(ranks(client, team).values())
    assert keys and all(keys) and len(set(keys)) == len(keys)


# --- the migration ------------------------------------------------------------------


def _migration():
    import importlib.util
    import pathlib

    path = next(
        pathlib.Path(__file__)
        .resolve()
        .parents[1]
        .glob("alembic/versions/1c6e8a0f4b27_*.py")
    )
    spec = importlib.util.spec_from_file_location("rank_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_migrations_keys_are_the_applications_keys():
    """The migration encodes keys itself, to stay frozen. They must be the
    ones the application's generator produces, or a key written later could
    land between two the migration wrote and sort wrongly."""
    encode = _migration().integer_key
    expected = list(itertools.islice(keys_in_order(), 4000))
    assert [encode(n) for n in range(4000)] == expected


def test_upgrading_keeps_the_order_the_board_already_showed(tmp_path):
    db_path = tmp_path / "rank.db"
    config = Config("alembic.ini")
    config.set_main_option("script_location", "alembic")
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    command.upgrade(config, "07a9c3e5b1d4")

    connection = sqlite3.connect(db_path)
    stamp = "'2026-01-01 00:00:00'"
    connection.execute(
        "INSERT INTO team (id, name, key, next_issue_number, next_cycle_number,"
        f" created_at) VALUES (1, 'Engineering', 'ENG', 70, 1, {stamp})"
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
    # 65 issues, so the keys cross from `az` into `b00`.
    connection.executemany(
        "INSERT INTO issue (team_id, number, title, status_id, priority, type,"
        f" creator_id, created_at, updated_at) VALUES (1, ?, ?, 1, 'no_priority',"
        f" 'task', 1, {stamp}, {stamp})",
        [(n, f"#{n}") for n in range(1, 66)],
    )
    connection.commit()
    connection.close()

    command.upgrade(config, "1c6e8a0f4b27")
    connection = sqlite3.connect(db_path)
    by_rank = [
        row[0] for row in connection.execute("SELECT number FROM issue ORDER BY rank")
    ]
    connection.close()
    assert by_rank == list(range(65, 0, -1))

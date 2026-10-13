"""The label name key migration (#321), against a team that already has two
labels differing only in case.

The constraint cannot go on over "Bug" and "bug", so the migration merges
them into the older one first. What matters is that nothing that pointed at
the younger one is lost: its tickets, a saved view filtering by it, and an
automation rule naming it all end up on the survivor, and a ticket that
carried both keeps one link.
"""

import sqlite3

import pytest
from alembic import command

from tests.test_employee_profile_migration import _read
from tests.test_reactions_migration import _config

BEFORE = "cf3f72037267"
AFTER = "266072764727"
NOW = "'2026-01-01 00:00:00'"


def _seed(db_path):
    connection = sqlite3.connect(db_path)
    run = connection.execute
    run(
        "INSERT INTO user (id, email, username, hashed_password, full_name,"
        " avatar_color, is_active, is_site_admin, is_finance_admin, token_version,"
        f" email_notifications, created_at) VALUES (1, 'a@b.c', 'a', 'x', 'A',"
        f" '#6366f1', 1, 0, 0, 0, 1, {NOW})"
    )
    for team_id, key in ((1, "ENG"), (2, "OPS")):
        run(
            "INSERT INTO team (id, name, key, next_ticket_number, next_sprint_number,"
            f" created_at) VALUES ({team_id}, '{key}', '{key}', 9, 1, {NOW})"
        )
    run(
        "INSERT INTO workflowstatus (id, team_id, name, category, position, color,"
        f" created_at) VALUES (1, 1, 'Todo', 'unstarted', 0, '#888', {NOW})"
    )
    # ENG has Bug (1), then bug (2) and " BUG " (3) added later; OPS has its
    # own "bug" (4), which is another team's and stays.
    for label_id, team_id, name in (
        (1, 1, "Bug"),
        (2, 1, "bug"),
        (3, 1, " BUG "),
        (4, 2, "bug"),
        (5, 1, "Feature"),
    ):
        run(
            "INSERT INTO label (id, team_id, name, color)"
            f" VALUES ({label_id}, {team_id}, '{name}', '#ef4444')"
        )
    for ticket_id in (1, 2, 3):
        run(
            "INSERT INTO ticket (id, team_id, number, title, priority, creator_id,"
            f" created_at, updated_at, status_id) VALUES ({ticket_id}, 1,"
            f" {ticket_id}, 'T{ticket_id}', 'no_priority', 1, {NOW}, {NOW}, 1)"
        )
    # Ticket 1 carries Bug and bug; ticket 2 only bug; ticket 3 " BUG ".
    for ticket_id, label_id in ((1, 1), (1, 2), (2, 2), (3, 3), (3, 5)):
        run(f"INSERT INTO ticketlabellink VALUES ({ticket_id}, {label_id})")
    run(
        "INSERT INTO savedview (id, team_id, name, owner_id, is_shared, unassigned,"
        f" created_at, updated_at, group_by, label_id) VALUES (1, 1, 'Bugs', 1, 1,"
        f" 0, {NOW}, {NOW}, 'status', 2)"
    )
    run(
        'INSERT INTO automationrule (id, team_id, name, is_enabled, "trigger",'
        " if_unassigned, move_to_active_sprint, created_by_id, created_at,"
        f" updated_at, if_label_id, add_label_id) VALUES (1, 1, 'Triage', 1,"
        f" 'ticket_created', 0, 0, 1, {NOW}, {NOW}, 3, 2)"
    )
    connection.commit()
    connection.close()


@pytest.fixture
def upgraded(tmp_path):
    db_path = tmp_path / "labels.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)
    _seed(db_path)
    command.upgrade(config, AFTER)
    return db_path, config


def test_names_differing_only_in_case_merge_into_the_oldest(upgraded):
    db_path, _ = upgraded
    assert _read(
        db_path, "SELECT id, team_id, name, name_key FROM label ORDER BY id"
    ) == [
        (1, 1, "Bug", "bug"),
        (4, 2, "bug", "bug"),
        (5, 1, "Feature", "feature"),
    ]


def test_nothing_that_pointed_at_a_merged_label_is_lost(upgraded):
    db_path, _ = upgraded
    assert _read(
        db_path, "SELECT ticket_id, label_id FROM ticketlabellink ORDER BY 1, 2"
    ) == [(1, 1), (2, 1), (3, 1), (3, 5)]
    assert _read(db_path, "SELECT label_id FROM savedview") == [(1,)]
    assert _read(db_path, "SELECT if_label_id, add_label_id FROM automationrule") == [
        (1, 1)
    ]


def test_the_key_is_unique_per_team(upgraded):
    db_path, _ = upgraded
    connection = sqlite3.connect(db_path)
    try:
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO label (team_id, name, color, name_key)"
                " VALUES (1, 'BUG', '#000', 'bug')"
            )
        # Another team's "bug" is its own business.
        connection.execute(
            "INSERT INTO label (team_id, name, color, name_key)"
            " VALUES (2, 'Feature', '#000', 'feature')"
        )
    finally:
        connection.close()


def test_the_downgrade_drops_the_key_and_keeps_the_merge(upgraded):
    db_path, config = upgraded
    command.downgrade(config, BEFORE)
    columns = {row[1] for row in _read(db_path, "PRAGMA table_info(label)")}
    assert "name_key" not in columns
    assert _read(db_path, "SELECT id, name FROM label ORDER BY id") == [
        (1, "Bug"),
        (4, "bug"),
        (5, "Feature"),
    ]
    command.upgrade(config, AFTER)
    assert _read(db_path, "SELECT name_key FROM label ORDER BY id") == [
        ("bug",),
        ("bug",),
        ("feature",),
    ]

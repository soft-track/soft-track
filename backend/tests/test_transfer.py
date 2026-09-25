"""Moving an issue to another team (#98)."""

from datetime import date, timedelta

import pytest
from sqlmodel import select

from lib_softtrack.tables import IssueEvent, IssueEventField, Notification
from tests.conftest import status_ids


@pytest.fixture
def two_teams(client, team):
    """ENG (the `team` fixture) and OPS, both run by the same person."""
    ops = client.post(
        "/teams", json={"name": "Operations", "key": "OPS"}, headers=team["headers"]
    ).json()
    # Some history on OPS, so its next number is not ENG's.
    for title in ("Rotate keys", "Patch hosts"):
        client.post(
            f"/teams/{ops['id']}/issues", json={"title": title}, headers=team["headers"]
        )
    return {
        **team,
        "ops": ops,
        "ops_status_ids": status_ids(client, team, ops["id"]),
    }


def make_issue(client, actor, team_id, **fields):
    response = client.post(
        f"/teams/{team_id}/issues",
        json={"title": "Pager fires twice", **fields},
        headers=actor["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def transfer(client, actor, issue, team_id, expect=200):
    response = client.post(
        f"/issues/{issue['id']}/transfer",
        json={"team_id": team_id},
        headers=actor["headers"],
    )
    assert response.status_code == expect, response.text
    return response.json()


def preview(client, actor, issue, team_id, expect=200):
    response = client.get(
        f"/issues/{issue['id']}/transfer",
        params={"team_id": team_id},
        headers=actor["headers"],
    )
    assert response.status_code == expect, response.text
    return response.json()


def label(client, actor, team_id, name):
    response = client.post(
        f"/teams/{team_id}/labels",
        json={"name": name, "color": "#123456"},
        headers=actor["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def join(client, owner, team_id, person, role="member"):
    response = client.post(
        f"/teams/{team_id}/members",
        json={"email": person["user"]["email"], "role": role},
        headers=owner["headers"],
    )
    assert response.status_code == 200, response.text


# --- the move itself ---------------------------------------------------------


def test_the_issue_takes_the_target_teams_next_key(client, two_teams):
    issue = make_issue(client, two_teams, two_teams["team"]["id"])
    assert issue["identifier"] == "ENG-1"

    moved = transfer(client, two_teams, issue, two_teams["ops"]["id"])["issue"]
    assert moved["id"] == issue["id"]
    assert moved["identifier"] == "OPS-3"
    assert moved["team_id"] == two_teams["ops"]["id"]

    # ENG never hands out 1 again: the old key means only this issue, forever.
    again = make_issue(client, two_teams, two_teams["team"]["id"])
    assert again["identifier"] == "ENG-2"


def test_it_says_where_it_came_from(client, two_teams, session):
    issue = make_issue(client, two_teams, two_teams["team"]["id"])
    transfer(client, two_teams, issue, two_teams["ops"]["id"])

    comments = client.get(
        f"/issues/{issue['id']}/comments", headers=two_teams["headers"]
    ).json()
    assert [c["body"] for c in comments["items"]] == ["Moved from ENG-1."]
    assert comments["items"][0]["author"]["id"] == two_teams["user"]["id"]

    events = client.get(
        f"/issues/{issue['id']}/events", headers=two_teams["headers"]
    ).json()
    [moved] = [e for e in events if e["field"] == "team"]
    assert (moved["old_value"], moved["new_value"]) == ("ENG-1", "OPS-3")


def test_the_old_key_is_found_by_search(client, two_teams):
    issue = make_issue(
        client, two_teams, two_teams["team"]["id"], title="Pager fires twice"
    )
    transfer(client, two_teams, issue, two_teams["ops"]["id"])

    hits = client.get(
        "/search", params={"q": "ENG-1"}, headers=two_teams["headers"]
    ).json()
    assert "OPS-3" in [hit["identifier"] for hit in hits["items"]]


def test_the_move_notifies_nobody(client, two_teams, auth, session):
    watcher = auth(email="watcher@softtrack.dev", full_name="Watcher")
    join(client, two_teams, two_teams["team"]["id"], watcher)
    join(client, two_teams, two_teams["ops"]["id"], watcher)
    issue = make_issue(client, two_teams, two_teams["team"]["id"])
    client.put(
        f"/issues/{issue['id']}/watch",
        json={"watching": True},
        headers=watcher["headers"],
    )
    before = len(session.exec(select(Notification)).all())
    transfer(client, two_teams, issue, two_teams["ops"]["id"])
    assert len(session.exec(select(Notification)).all()) == before


def test_everything_keyed_by_the_issue_comes_along(client, two_teams):
    issue = make_issue(client, two_teams, two_teams["team"]["id"])
    other = make_issue(client, two_teams, two_teams["team"]["id"], title="Other")
    client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "First look"},
        headers=two_teams["headers"],
    )
    client.post(
        f"/issues/{issue['id']}/links",
        json={"target_id": other["id"], "type": "blocks"},
        headers=two_teams["headers"],
    )
    transfer(client, two_teams, issue, two_teams["ops"]["id"])

    comments = client.get(
        f"/issues/{issue['id']}/comments", headers=two_teams["headers"]
    ).json()
    assert [c["body"] for c in comments["items"]] == ["First look", "Moved from ENG-1."]
    links = client.get(
        f"/issues/{issue['id']}/links", headers=two_teams["headers"]
    ).json()
    assert [row["issue"]["identifier"] for row in links["blocks"]] == ["ENG-2"]


# --- remapping ---------------------------------------------------------------


def test_status_maps_by_category(client, two_teams):
    issue = make_issue(
        client,
        two_teams,
        two_teams["team"]["id"],
        status_id=two_teams["status_ids"]["In Review"],
    )
    moved = transfer(client, two_teams, issue, two_teams["ops"]["id"])["issue"]
    # "In Review" is `started`; OPS's first `started` column is "In Progress".
    assert moved["status"]["id"] == two_teams["ops_status_ids"]["In Progress"]


def test_status_falls_back_to_the_first_column(client, two_teams):
    ops = two_teams["ops"]["id"]
    backlog = two_teams["ops_status_ids"]["Backlog"]
    for name in ("In Progress", "In Review"):
        response = client.request(
            "DELETE",
            f"/statuses/{two_teams['ops_status_ids'][name]}",
            json={"move_to_id": backlog},
            headers=two_teams["headers"],
        )
        assert response.status_code == 200, response.text

    issue = make_issue(
        client,
        two_teams,
        two_teams["team"]["id"],
        status_id=two_teams["status_ids"]["In Progress"],
    )
    plan = preview(client, two_teams, issue, ops)
    assert plan["status"] == {
        "from_name": "In Progress",
        "to_name": "Backlog",
        "same_category": False,
    }
    assert (
        transfer(client, two_teams, issue, ops)["issue"]["status"]["name"] == "Backlog"
    )


def test_labels_are_kept_by_name_and_dropped_otherwise(client, two_teams):
    eng, ops = two_teams["team"]["id"], two_teams["ops"]["id"]
    bug = label(client, two_teams, eng, "Bug")
    frontend = label(client, two_teams, eng, "frontend")
    ops_bug = label(client, two_teams, ops, "bug")
    issue = make_issue(client, two_teams, eng, label_ids=[bug["id"], frontend["id"]])

    plan = preview(client, two_teams, issue, ops)
    assert plan["labels_kept"] == ["bug"]
    assert plan["labels_dropped"] == ["frontend"]

    moved = transfer(client, two_teams, issue, ops)["issue"]
    assert [lab["id"] for lab in moved["labels"]] == [ops_bug["id"]]


def test_cycle_and_project_are_cleared_and_the_cycle_sees_it_leave(
    client, two_teams, session
):
    eng = two_teams["team"]["id"]
    start = date.today()
    cycle = client.post(
        f"/teams/{eng}/cycles",
        json={
            "name": "Sprint 4",
            "starts_at": start.isoformat(),
            "ends_at": (start + timedelta(days=14)).isoformat(),
        },
        headers=two_teams["headers"],
    ).json()
    project = client.post(
        f"/teams/{eng}/projects", json={"name": "Launch"}, headers=two_teams["headers"]
    ).json()
    issue = make_issue(
        client, two_teams, eng, cycle_id=cycle["id"], project_id=project["id"]
    )

    plan = preview(client, two_teams, issue, two_teams["ops"]["id"])
    assert (plan["cycle_cleared"], plan["project_cleared"]) == ("Sprint 4", "Launch")

    moved = transfer(client, two_teams, issue, two_teams["ops"]["id"])["issue"]
    assert moved["cycle_id"] is None and moved["project_id"] is None

    # The burndown reads cycle events: without this row the issue would stay
    # in Sprint 4's scope forever.
    left = session.exec(
        select(IssueEvent)
        .where(
            IssueEvent.issue_id == issue["id"],
            IssueEvent.field == IssueEventField.cycle,
        )
        .order_by(IssueEvent.id)
    ).all()[-1]
    assert (left.old_value, left.new_value) == (str(cycle["id"]), None)


def test_the_assignee_stays_only_if_they_are_on_the_target_team(
    client, two_teams, auth
):
    eng, ops = two_teams["team"]["id"], two_teams["ops"]["id"]
    maya = auth(email="maya@softtrack.dev", full_name="Maya Chen")
    join(client, two_teams, eng, maya)
    theirs = make_issue(client, two_teams, eng, assignee_id=maya["user"]["id"])
    mine = make_issue(client, two_teams, eng, assignee_id=two_teams["user"]["id"])

    assert preview(client, two_teams, theirs, ops)["assignee_cleared"] == "Maya Chen"
    assert transfer(client, two_teams, theirs, ops)["issue"]["assignee"] is None
    assert preview(client, two_teams, mine, ops)["assignee_cleared"] is None
    assert (
        transfer(client, two_teams, mine, ops)["issue"]["assignee"]["id"]
        == two_teams["user"]["id"]
    )


# --- sub-issues --------------------------------------------------------------


def test_sub_issues_move_with_their_parent(client, two_teams):
    eng = two_teams["team"]["id"]
    parent = make_issue(client, two_teams, eng, title="Parent")
    first = make_issue(client, two_teams, eng, title="First", parent_id=parent["id"])
    second = make_issue(client, two_teams, eng, title="Second", parent_id=parent["id"])

    assert preview(client, two_teams, parent, two_teams["ops"]["id"])["sub_issues"] == [
        "ENG-2",
        "ENG-3",
    ]
    result = transfer(client, two_teams, parent, two_teams["ops"]["id"])
    assert result["issue"]["identifier"] == "OPS-3"
    assert [c["identifier"] for c in result["sub_issues"]] == ["OPS-4", "OPS-5"]
    for child in (first, second):
        moved = client.get(
            f"/issues/{child['id']}", headers=two_teams["headers"]
        ).json()
        assert moved["team_id"] == two_teams["ops"]["id"]
        assert moved["parent"]["identifier"] == "OPS-3"


def test_a_sub_issue_moved_alone_leaves_its_parent(client, two_teams):
    eng = two_teams["team"]["id"]
    parent = make_issue(client, two_teams, eng, title="Parent")
    child = make_issue(client, two_teams, eng, title="Child", parent_id=parent["id"])

    assert (
        preview(client, two_teams, child, two_teams["ops"]["id"])["parent_detached"]
        == "ENG-1"
    )
    moved = transfer(client, two_teams, child, two_teams["ops"]["id"])["issue"]
    assert moved["parent"] is None
    assert (
        client.get(f"/issues/{parent['id']}", headers=two_teams["headers"]).json()[
            "child_count"
        ]
        == 0
    )


# --- the preview -------------------------------------------------------------


def test_the_preview_changes_nothing_and_predicts_the_key(client, two_teams):
    issue = make_issue(client, two_teams, two_teams["team"]["id"])
    plan = preview(client, two_teams, issue, two_teams["ops"]["id"])
    assert (plan["from_identifier"], plan["to_identifier"]) == ("ENG-1", "OPS-3")
    assert (
        client.get(f"/issues/{issue['id']}", headers=two_teams["headers"]).json()[
            "identifier"
        ]
        == "ENG-1"
    )
    assert (
        transfer(client, two_teams, issue, two_teams["ops"]["id"])["issue"][
            "identifier"
        ]
        == plan["to_identifier"]
    )


# --- who may -----------------------------------------------------------------


def test_the_same_team_is_refused(client, two_teams):
    issue = make_issue(client, two_teams, two_teams["team"]["id"])
    response = client.post(
        f"/issues/{issue['id']}/transfer",
        json={"team_id": two_teams["team"]["id"]},
        headers=two_teams["headers"],
    )
    assert response.status_code == 400
    assert response.json()["code"] == "transfer_same_team"


def test_you_must_be_on_the_target_team(client, two_teams, auth):
    maya = auth(email="maya@softtrack.dev", full_name="Maya Chen")
    join(client, two_teams, two_teams["team"]["id"], maya)
    issue = make_issue(client, maya, two_teams["team"]["id"])
    for response in (
        client.get(
            f"/issues/{issue['id']}/transfer",
            params={"team_id": two_teams["ops"]["id"]},
            headers=maya["headers"],
        ),
        client.post(
            f"/issues/{issue['id']}/transfer",
            json={"team_id": two_teams["ops"]["id"]},
            headers=maya["headers"],
        ),
    ):
        assert response.status_code == 403
        assert response.json()["code"] == "not_team_member"


def test_a_guest_of_the_target_team_cannot_move_work_into_it(client, two_teams, auth):
    maya = auth(email="maya@softtrack.dev", full_name="Maya Chen")
    join(client, two_teams, two_teams["team"]["id"], maya)
    join(client, two_teams, two_teams["ops"]["id"], maya, role="guest")
    issue = make_issue(client, maya, two_teams["team"]["id"])
    response = client.post(
        f"/issues/{issue['id']}/transfer",
        json={"team_id": two_teams["ops"]["id"]},
        headers=maya["headers"],
    )
    assert response.status_code == 403
    assert response.json()["code"] == "team_read_only"


def test_a_missing_team_is_a_404(client, two_teams):
    issue = make_issue(client, two_teams, two_teams["team"]["id"])
    response = client.post(
        f"/issues/{issue['id']}/transfer",
        json={"team_id": 999},
        headers=two_teams["headers"],
    )
    assert response.status_code == 404
    assert response.json()["code"] == "team_not_found"


def test_the_migration_forgets_move_events_on_the_way_down(tmp_path):
    """Upgrade, record a move event, downgrade: the row goes, nothing else."""
    import sqlite3

    from alembic import command
    from alembic.config import Config

    db_path = tmp_path / "moves.db"
    config = Config("alembic.ini")
    config.set_main_option("script_location", "alembic")
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    command.upgrade(config, "9d3f6b1e8a24")
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
        "INSERT INTO issueevent (issue_id, team_id, field, old_value, new_value,"
        " created_at, opening) VALUES (1, 1, 'team', 'OPS-4', 'ENG-1',"
        " '2026-01-02', 0), (1, 1, 'status', NULL, 'unstarted', '2026-01-01', 1);"
    )
    connection.commit()
    connection.close()

    command.downgrade(config, "6e2a9c4f7d10")
    connection = sqlite3.connect(db_path)
    fields = [row[0] for row in connection.execute("SELECT field FROM issueevent")]
    connection.close()
    assert fields == ["status"]
    command.upgrade(config, "9d3f6b1e8a24")

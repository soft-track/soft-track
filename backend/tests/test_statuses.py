"""Per-team custom statuses (issue #22).

The property most of these guard: **a team can invent a column, and nothing
that reasons about work notices.** Burndown, cycle completion, sub-issue
progress and blocker counting all read the fixed category, so a status called
"Blocked" behaves exactly like the "In Progress" it was cloned from -- and one
called "Shipped" counts as finished everywhere without a single call site
learning its name.
"""

import pytest
from sqlmodel import select

from lib_softtrack.tables import IssueEvent, IssueEventField


@pytest.fixture
def pair(client, team, auth):
    """An admin and a plain member: statuses are admin-only to change."""
    member = auth(email="member@softtrack.dev", full_name="Plain Member")
    response = client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": "member@softtrack.dev"},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return {**team, "member": member}


def statuses(client, actor, team_id):
    response = client.get(f"/teams/{team_id}/statuses", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def add_status(client, actor, team_id, name, category="started", color="#123456"):
    return client.post(
        f"/teams/{team_id}/statuses",
        json={"name": name, "category": category, "color": color},
        headers=actor["headers"],
    )


def make_issue(client, actor, team_id, title="Some work", **fields):
    response = client.post(
        f"/teams/{team_id}/issues",
        json={"title": title, **fields},
        headers=actor["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def move(client, actor, issue, status_id):
    response = client.patch(
        f"/issues/{issue['id']}",
        json={"status_id": status_id},
        headers=actor["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


# --- what a team starts with --------------------------------------------


def test_a_new_team_gets_the_workflow_the_enum_used_to_describe(client, pair):
    rows = statuses(client, pair, pair["team"]["id"])
    assert [(row["name"], row["category"]) for row in rows] == [
        ("Backlog", "backlog"),
        ("Todo", "unstarted"),
        ("In Progress", "started"),
        ("In Review", "started"),
        ("Done", "done"),
        ("Cancelled", "cancelled"),
    ]
    assert [row["position"] for row in rows] == [0, 1, 2, 3, 4, 5]


def test_a_new_issue_lands_in_the_leftmost_column(client, pair):
    issue = make_issue(client, pair, pair["team"]["id"])
    assert issue["status"]["name"] == "Backlog"


def test_a_member_can_read_the_workflow_but_not_change_it(client, pair):
    assert len(statuses(client, pair["member"], pair["team"]["id"])) == 6
    response = add_status(
        client, pair["member"], pair["team"]["id"], "Blocked", "started"
    )
    assert response.status_code == 403


def test_a_non_member_cannot_read_it(client, pair, auth):
    outsider = auth(email="outside@softtrack.dev")
    response = client.get(
        f"/teams/{pair['team']['id']}/statuses", headers=outsider["headers"]
    )
    assert response.status_code == 403


# --- adding and editing --------------------------------------------------


def test_an_admin_adds_a_column_and_it_lands_at_the_end(client, pair):
    response = add_status(client, pair, pair["team"]["id"], "Blocked", "started")
    assert response.status_code == 200, response.text
    assert response.json()["position"] == 6
    assert [row["name"] for row in statuses(client, pair, pair["team"]["id"])][-1] == (
        "Blocked"
    )


def test_two_columns_on_one_team_cannot_share_a_name(client, pair):
    assert add_status(client, pair, pair["team"]["id"], "Blocked").status_code == 200
    response = add_status(client, pair, pair["team"]["id"], "Blocked")
    assert response.status_code == 400
    assert "already has a status with that name" in response.json()["detail"]


def test_two_teams_can_both_have_a_done(client, pair):
    """The whole point of statuses being rows: they belong to one team."""
    other = client.post(
        "/teams", json={"name": "Design", "key": "DSG"}, headers=pair["headers"]
    ).json()
    mine = {
        row["name"]: row["id"] for row in statuses(client, pair, pair["team"]["id"])
    }
    theirs = {row["name"]: row["id"] for row in statuses(client, pair, other["id"])}
    assert mine["Done"] != theirs["Done"]


def test_renaming_recolouring_and_recategorising(client, pair):
    status = [
        row
        for row in statuses(client, pair, pair["team"]["id"])
        if row["name"] == "In Review"
    ][0]
    response = client.patch(
        f"/statuses/{status['id']}",
        json={"name": "QA", "category": "done", "color": "#abcdef"},
        headers=pair["headers"],
    )
    assert response.status_code == 200, response.text
    assert response.json()["name"] == "QA"
    assert response.json()["category"] == "done"
    assert response.json()["color"] == "#abcdef"


def test_an_issue_cannot_be_moved_into_another_teams_column(client, pair):
    """It would vanish from its own board."""
    other = client.post(
        "/teams", json={"name": "Design", "key": "DSG"}, headers=pair["headers"]
    ).json()
    foreign = statuses(client, pair, other["id"])[0]
    issue = make_issue(client, pair, pair["team"]["id"])

    response = client.patch(
        f"/issues/{issue['id']}",
        json={"status_id": foreign["id"]},
        headers=pair["headers"],
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "No such status on this team"


# --- ordering ------------------------------------------------------------


def test_reordering_changes_the_board_order(client, pair):
    rows = statuses(client, pair, pair["team"]["id"])
    reversed_ids = [row["id"] for row in reversed(rows)]

    response = client.put(
        f"/teams/{pair['team']['id']}/statuses/order",
        json={"status_ids": reversed_ids},
        headers=pair["headers"],
    )
    assert response.status_code == 200, response.text
    assert [row["name"] for row in response.json()][0] == "Cancelled"
    assert [row["id"] for row in statuses(client, pair, pair["team"]["id"])] == (
        reversed_ids
    )


def test_a_partial_reorder_is_refused(client, pair):
    """A client working from a stale board would otherwise drop a column's
    position silently."""
    rows = statuses(client, pair, pair["team"]["id"])
    response = client.put(
        f"/teams/{pair['team']['id']}/statuses/order",
        json={"status_ids": [rows[0]["id"], rows[1]["id"]]},
        headers=pair["headers"],
    )
    assert response.status_code == 400
    assert "exactly once" in response.json()["detail"]


def test_a_member_cannot_reorder(client, pair):
    rows = statuses(client, pair, pair["team"]["id"])
    response = client.put(
        f"/teams/{pair['team']['id']}/statuses/order",
        json={"status_ids": [row["id"] for row in rows]},
        headers=pair["member"]["headers"],
    )
    assert response.status_code == 403


# --- deleting, and where the work goes ------------------------------------


def delete_status(client, actor, status_id, move_to_id):
    return client.request(
        "DELETE",
        f"/statuses/{status_id}",
        json={"move_to_id": move_to_id},
        headers=actor["headers"],
    )


def test_deleting_a_status_moves_its_issues(client, pair):
    ids = {row["name"]: row["id"] for row in statuses(client, pair, pair["team"]["id"])}
    issue = make_issue(client, pair, pair["team"]["id"], status_id=ids["In Review"])

    response = delete_status(client, pair, ids["In Review"], ids["In Progress"])
    assert response.status_code == 200, response.text
    assert "In Review" not in [row["name"] for row in response.json()]

    moved = client.get(f"/issues/{issue['id']}", headers=pair["headers"]).json()
    assert moved["status"]["name"] == "In Progress"


def test_deleting_a_status_writes_no_history(client, pair, session):
    """The work did not change state -- the column under it was removed. A
    status event per issue would put a step in every cumulative flow diagram
    on the day an admin tidied up the board."""
    ids = {row["name"]: row["id"] for row in statuses(client, pair, pair["team"]["id"])}
    issue = make_issue(client, pair, pair["team"]["id"], status_id=ids["In Review"])
    before = len(
        session.exec(
            select(IssueEvent).where(IssueEvent.field == IssueEventField.status)
        ).all()
    )

    delete_status(client, pair, ids["In Review"], ids["Todo"])

    after = session.exec(
        select(IssueEvent).where(IssueEvent.field == IssueEventField.status)
    ).all()
    assert len(after) == before
    assert issue["id"]


def test_the_last_status_cannot_be_deleted(client, pair):
    rows = statuses(client, pair, pair["team"]["id"])
    for row in rows[1:]:
        assert delete_status(client, pair, row["id"], rows[0]["id"]).status_code == 200

    remaining = statuses(client, pair, pair["team"]["id"])
    assert len(remaining) == 1
    response = delete_status(client, pair, remaining[0]["id"], remaining[0]["id"])
    assert response.status_code == 409
    assert "at least one status" in response.json()["detail"]


def test_issues_cannot_be_moved_to_the_status_being_deleted(client, pair):
    ids = {row["name"]: row["id"] for row in statuses(client, pair, pair["team"]["id"])}
    response = delete_status(client, pair, ids["Todo"], ids["Todo"])
    assert response.status_code == 400


def test_issues_cannot_be_moved_to_another_teams_status(client, pair):
    other = client.post(
        "/teams", json={"name": "Design", "key": "DSG"}, headers=pair["headers"]
    ).json()
    foreign = statuses(client, pair, other["id"])[0]
    ids = {row["name"]: row["id"] for row in statuses(client, pair, pair["team"]["id"])}

    response = delete_status(client, pair, ids["Todo"], foreign["id"])
    assert response.status_code == 400


def test_deleting_a_status_widens_the_views_that_filtered_on_it(client, pair):
    """A view left pointing at a status that no longer exists would match
    nothing, which reads as broken rather than as a widened filter."""
    ids = {row["name"]: row["id"] for row in statuses(client, pair, pair["team"]["id"])}
    view = client.post(
        f"/teams/{pair['team']['id']}/views",
        json={"name": "In review", "filters": {"status_id": ids["In Review"]}},
        headers=pair["headers"],
    ).json()

    delete_status(client, pair, ids["In Review"], ids["Todo"])

    listed = client.get(
        f"/teams/{pair['team']['id']}/views", headers=pair["headers"]
    ).json()["items"]
    assert [row["id"] for row in listed] == [view["id"]]
    assert listed[0]["filters"]["status_id"] is None


def test_a_member_cannot_delete_a_status(client, pair):
    ids = {row["name"]: row["id"] for row in statuses(client, pair, pair["team"]["id"])}
    response = delete_status(client, pair["member"], ids["Todo"], ids["Backlog"])
    assert response.status_code == 403


# --- the categories are what everything else reads ------------------------


def test_a_custom_started_column_is_not_finished(client, pair):
    """ "Blocked" is a column a team invents; nothing treats it as done."""
    blocked = add_status(client, pair, pair["team"]["id"], "Blocked", "started").json()
    parent = make_issue(client, pair, pair["team"]["id"], "P")
    child = make_issue(client, pair, pair["team"]["id"], "C", parent_id=parent["id"])
    move(client, pair, child, blocked["id"])

    fetched = client.get(f"/issues/{parent['id']}", headers=pair["headers"]).json()
    assert (fetched["completed_child_count"], fetched["child_count"]) == (0, 1)


def test_a_custom_done_column_counts_as_finished_everywhere(client, pair):
    """The name is the team's business; `done` is what the tracker reads."""
    shipped = add_status(client, pair, pair["team"]["id"], "Shipped", "done").json()

    parent = make_issue(client, pair, pair["team"]["id"], "P")
    child = make_issue(client, pair, pair["team"]["id"], "C", parent_id=parent["id"])
    move(client, pair, child, shipped["id"])
    fetched = client.get(f"/issues/{parent['id']}", headers=pair["headers"]).json()
    assert (fetched["completed_child_count"], fetched["child_count"]) == (1, 1)

    # And a blocker in it stops blocking.
    blocker = make_issue(client, pair, pair["team"]["id"], "Blocker")
    blocked = make_issue(client, pair, pair["team"]["id"], "Blocked by it")
    client.post(
        f"/issues/{blocker['id']}/links",
        json={"target_id": blocked["id"], "type": "blocks"},
        headers=pair["headers"],
    )
    assert (
        client.get(f"/issues/{blocked['id']}", headers=pair["headers"]).json()[
            "blocked_by_count"
        ]
        == 1
    )
    move(client, pair, blocker, shipped["id"])
    assert (
        client.get(f"/issues/{blocked['id']}", headers=pair["headers"]).json()[
            "blocked_by_count"
        ]
        == 0
    )


def test_moving_between_two_started_columns_records_no_history(client, pair, session):
    """Both mean `started`, so nothing about the work changed as far as any
    report is concerned. A row here would put a phantom step in the
    cumulative flow diagram."""
    ids = {row["name"]: row["id"] for row in statuses(client, pair, pair["team"]["id"])}
    issue = make_issue(client, pair, pair["team"]["id"], status_id=ids["In Progress"])

    before = len(
        session.exec(
            select(IssueEvent).where(
                IssueEvent.issue_id == issue["id"],
                IssueEvent.field == IssueEventField.status,
            )
        ).all()
    )
    move(client, pair, issue, ids["In Review"])
    after = session.exec(
        select(IssueEvent).where(
            IssueEvent.issue_id == issue["id"],
            IssueEvent.field == IssueEventField.status,
        )
    ).all()
    assert len(after) == before

    # But moving to a column that means something else does record one.
    move(client, pair, issue, ids["Done"])
    recorded = session.exec(
        select(IssueEvent).where(
            IssueEvent.issue_id == issue["id"],
            IssueEvent.field == IssueEventField.status,
        )
    ).all()
    assert len(recorded) == before + 1
    assert recorded[-1].old_value == "started"
    assert recorded[-1].new_value == "done"

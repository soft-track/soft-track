"""Bulk edit and bulk delete (soft-track#27).

The property that matters most is the one the issue calls out: one request,
and transactional. Most of these tests check that a batch with one bad member
changes nothing at all, not merely that it returns an error.
"""

import io

import pytest
from fastapi import HTTPException
from sqlmodel import select

from lib_softtrack import rules as rules_service
from lib_softtrack.models.issues import MAX_BULK_ISSUES
from lib_softtrack.storage import ObjectNotFound
from lib_softtrack.tables import Attachment, IssueEvent, Notification

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture
def board(client, team, auth):
    """A team with a second member, two labels and three issues."""
    team_id = team["team"]["id"]
    member = auth(email="member@softtrack.dev", full_name="Plain Member")
    client.post(
        f"/teams/{team_id}/members",
        json={"email": "member@softtrack.dev"},
        headers=team["headers"],
    )

    def label(name):
        return client.post(
            f"/teams/{team_id}/labels", json={"name": name}, headers=team["headers"]
        ).json()

    bug, chore = label("Bug"), label("Chore")

    def issue(title, **fields):
        response = client.post(
            f"/teams/{team_id}/issues",
            json={"title": title, **fields},
            headers=team["headers"],
        )
        assert response.status_code == 200, response.text
        return response.json()

    issues = [
        issue("one", label_ids=[bug["id"]]),
        issue("two", label_ids=[chore["id"]]),
        issue("three", assignee_id=team["user"]["id"]),
    ]
    return {
        **team,
        "team_id": team_id,
        "member": member,
        "bug": bug,
        "chore": chore,
        "issues": issues,
        "ids": [row["id"] for row in issues],
    }


def bulk_update(client, board, issue_ids, **changes):
    return client.post(
        f"/teams/{board['team_id']}/issues/bulk-update",
        json={"issue_ids": issue_ids, "changes": changes},
        headers=board["headers"],
    )


def bulk_delete(client, board, issue_ids, headers=None):
    return client.post(
        f"/teams/{board['team_id']}/issues/bulk-delete",
        json={"issue_ids": issue_ids},
        headers=headers or board["headers"],
    )


def fetch(client, board, issue_id):
    return client.get(f"/issues/{issue_id}", headers=board["headers"])


def other_team(client, auth):
    outsider = auth(email="other@softtrack.dev", full_name="Other Team")
    created = client.post(
        "/teams", json={"name": "Design", "key": "DES"}, headers=outsider["headers"]
    ).json()
    return {**outsider, "team": created}


# --- bulk update -------------------------------------------------------


def test_one_request_changes_every_issue(client, board):
    response = bulk_update(
        client,
        board,
        board["ids"],
        status_id=board["status_ids"]["In Progress"],
        priority="urgent",
    )
    assert response.status_code == 200, response.text

    body = response.json()
    assert [row["id"] for row in body] == board["ids"]
    assert {row["status"]["name"] for row in body} == {"In Progress"}
    assert {row["priority"] for row in body} == {"urgent"}
    for issue_id in board["ids"]:
        assert fetch(client, board, issue_id).json()["priority"] == "urgent"


def test_fields_left_out_are_left_alone(client, board):
    bulk_update(client, board, board["ids"], priority="low")

    three = fetch(client, board, board["ids"][2]).json()
    assert three["assignee"]["id"] == board["user"]["id"]
    assert three["status"]["name"] == "Backlog"


def test_an_explicit_null_clears_the_assignee(client, board):
    response = bulk_update(client, board, board["ids"], assignee_id=None)
    assert response.status_code == 200, response.text
    assert [row["assignee"] for row in response.json()] == [None, None, None]


def test_a_null_status_is_ignored_rather_than_written(client, board):
    response = bulk_update(client, board, board["ids"], status_id=None)
    assert response.status_code == 200, response.text
    assert {row["status"]["name"] for row in response.json()} == {"Backlog"}


def test_labels_are_added_and_removed_not_replaced(client, board):
    response = bulk_update(
        client,
        board,
        board["ids"][:2],
        add_label_ids=[board["chore"]["id"]],
        remove_label_ids=[board["bug"]["id"]],
    )
    assert response.status_code == 200, response.text

    names = [
        sorted(label["name"] for label in row["labels"]) for row in response.json()
    ]
    # "one" loses Bug and gains Chore; "two" already had Chore and keeps it.
    assert names == [["Chore"], ["Chore"]]


def test_setting_project_and_cycle(client, board):
    project = client.post(
        f"/teams/{board['team_id']}/projects",
        json={"name": "Launch"},
        headers=board["headers"],
    ).json()
    cycle = client.post(
        f"/teams/{board['team_id']}/cycles",
        json={"starts_at": "2026-01-01T00:00:00Z", "ends_at": "2026-01-15T00:00:00Z"},
        headers=board["headers"],
    ).json()

    response = bulk_update(
        client, board, board["ids"], project_id=project["id"], cycle_id=cycle["id"]
    )
    assert response.status_code == 200, response.text
    assert {row["project_id"] for row in response.json()} == {project["id"]}
    assert {row["cycle_id"] for row in response.json()} == {cycle["id"]}


def test_each_issue_gets_its_own_history(client, board, session):
    bulk_update(client, board, board["ids"], status_id=board["status_ids"]["Done"])

    moved = session.exec(
        select(IssueEvent.issue_id).where(
            IssueEvent.issue_id.in_(board["ids"]), IssueEvent.old_value.is_not(None)
        )
    ).all()
    assert sorted(moved) == sorted(board["ids"])


def test_each_newly_assigned_issue_notifies_the_assignee(client, board, session):
    member_id = board["member"]["user"]["id"]
    bulk_update(client, board, board["ids"], assignee_id=member_id)

    notified = session.exec(
        select(Notification.issue_id).where(Notification.user_id == member_id)
    ).all()
    assert sorted(notified) == sorted(board["ids"])


def test_duplicate_ids_are_changed_once(client, board):
    ids = [board["ids"][0], board["ids"][0]]
    response = bulk_update(client, board, ids, priority="high")
    assert response.status_code == 200, response.text
    assert [row["id"] for row in response.json()] == [board["ids"][0]]


# --- all or nothing ----------------------------------------------------


def test_an_issue_from_another_team_fails_the_whole_batch(client, board, auth):
    theirs = other_team(client, auth)
    foreign = client.post(
        f"/teams/{theirs['team']['id']}/issues",
        json={"title": "not yours"},
        headers=theirs["headers"],
    ).json()

    response = bulk_update(
        client, board, [*board["ids"], foreign["id"]], priority="urgent"
    )
    assert response.status_code == 404
    assert str(foreign["id"]) in response.json()["detail"]
    for issue_id in board["ids"]:
        assert fetch(client, board, issue_id).json()["priority"] != "urgent"


def test_a_status_from_another_team_is_rejected(client, board, auth):
    theirs = other_team(client, auth)
    their_done = client.get(
        f"/teams/{theirs['team']['id']}/statuses", headers=theirs["headers"]
    ).json()[0]["id"]

    response = bulk_update(client, board, board["ids"], status_id=their_done)
    assert response.status_code == 400


@pytest.mark.parametrize("field", ["project", "cycle", "label"])
def test_a_project_cycle_or_label_from_another_team_is_rejected(
    client, board, auth, field
):
    theirs = other_team(client, auth)
    base = f"/teams/{theirs['team']['id']}"
    if field == "project":
        row = client.post(
            f"{base}/projects", json={"name": "Theirs"}, headers=theirs["headers"]
        ).json()
        changes = {"project_id": row["id"]}
    elif field == "cycle":
        row = client.post(
            f"{base}/cycles",
            json={
                "starts_at": "2026-01-01T00:00:00Z",
                "ends_at": "2026-01-15T00:00:00Z",
            },
            headers=theirs["headers"],
        ).json()
        changes = {"cycle_id": row["id"]}
    else:
        row = client.post(
            f"{base}/labels", json={"name": "Theirs"}, headers=theirs["headers"]
        ).json()
        changes = {"add_label_ids": [row["id"]]}

    response = bulk_update(client, board, board["ids"], **changes)
    assert response.status_code == 400
    assert field in response.json()["detail"]


def test_an_assignee_outside_the_team_is_rejected(client, board, auth):
    stranger = auth(email="stranger@softtrack.dev", full_name="Stranger")
    response = bulk_update(
        client, board, board["ids"], assignee_id=stranger["user"]["id"]
    )
    assert response.status_code == 400
    assert fetch(client, board, board["ids"][2]).json()["assignee"] is not None


def test_a_label_cannot_be_added_and_removed_at_once(client, board):
    label_id = board["bug"]["id"]
    response = bulk_update(
        client,
        board,
        board["ids"],
        add_label_ids=[label_id],
        remove_label_ids=[label_id],
    )
    assert response.status_code == 400


def test_a_failure_partway_through_rolls_back_the_issues_before_it(
    client, board, monkeypatch
):
    """The transactional guarantee itself.

    The first two issues are fully applied -- history, notifications, rules --
    before the third fails. None of it may survive.
    """
    real = rules_service.on_issue_updated
    calls = []

    def fail_on_the_third(session, issue, before, actor):
        calls.append(issue.id)
        if len(calls) == 3:
            raise HTTPException(status_code=409, detail="simulated failure")
        real(session, issue, before, actor)

    monkeypatch.setattr(rules_service, "on_issue_updated", fail_on_the_third)

    response = bulk_update(client, board, board["ids"], priority="urgent")
    assert response.status_code == 409
    assert len(calls) == 3

    monkeypatch.setattr(rules_service, "on_issue_updated", real)
    for issue_id in board["ids"]:
        assert fetch(client, board, issue_id).json()["priority"] == "no_priority"


def test_a_non_member_cannot_bulk_edit(client, board, auth):
    outsider = auth(email="outsider@softtrack.dev", full_name="Outsider")
    response = client.post(
        f"/teams/{board['team_id']}/issues/bulk-update",
        json={"issue_ids": board["ids"], "changes": {"priority": "urgent"}},
        headers=outsider["headers"],
    )
    assert response.status_code == 403


@pytest.mark.parametrize("count", [0, MAX_BULK_ISSUES + 1])
def test_the_batch_size_is_bounded(client, board, count):
    response = bulk_update(client, board, list(range(1, count + 1)), priority="low")
    assert response.status_code == 422


# --- bulk delete -------------------------------------------------------


def test_bulk_delete_removes_every_issue(client, board):
    response = bulk_delete(client, board, board["ids"][:2])
    assert response.status_code == 204, response.text

    assert fetch(client, board, board["ids"][0]).status_code == 404
    assert fetch(client, board, board["ids"][1]).status_code == 404
    assert fetch(client, board, board["ids"][2]).status_code == 200


@pytest.mark.parametrize("parent_first", [True, False])
def test_a_parent_and_its_sub_issue_can_go_together(client, board, parent_first):
    parent = board["issues"][0]
    child = client.post(
        f"/teams/{board['team_id']}/issues",
        json={"title": "child", "parent_id": parent["id"]},
        headers=board["headers"],
    ).json()
    ids = [parent["id"], child["id"]]

    response = bulk_delete(client, board, ids if parent_first else ids[::-1])
    assert response.status_code == 204, response.text
    assert fetch(client, board, child["id"]).status_code == 404


def test_bulk_delete_purges_attachments(client, board, storage, session):
    issue = board["issues"][0]
    uploaded = client.post(
        f"/issues/{issue['id']}/attachments",
        files={"file": ("shot.png", io.BytesIO(PNG), "image/png")},
        headers=board["headers"],
    ).json()
    key = session.get(Attachment, uploaded["id"]).storage_key

    assert bulk_delete(client, board, [issue["id"]]).status_code == 204
    with pytest.raises(ObjectNotFound):
        storage.open(key)


def test_bulk_delete_with_a_foreign_issue_deletes_nothing(client, board, auth):
    theirs = other_team(client, auth)
    foreign = client.post(
        f"/teams/{theirs['team']['id']}/issues",
        json={"title": "not yours"},
        headers=theirs["headers"],
    ).json()

    response = bulk_delete(client, board, [*board["ids"], foreign["id"]])
    assert response.status_code == 404
    for issue_id in board["ids"]:
        assert fetch(client, board, issue_id).status_code == 200
    assert (
        client.get(f"/issues/{foreign['id']}", headers=theirs["headers"]).status_code
        == 200
    )


def test_a_non_member_cannot_bulk_delete(client, board, auth):
    outsider = auth(email="outsider@softtrack.dev", full_name="Outsider")
    response = bulk_delete(client, board, board["ids"], headers=outsider["headers"])
    assert response.status_code == 403
    assert fetch(client, board, board["ids"][0]).status_code == 200

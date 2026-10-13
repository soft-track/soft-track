"""Bulk edit and bulk delete (soft-track#27).

The property that matters most is the one the ticket calls out: one request,
and transactional. Most of these tests check that a batch with one bad member
changes nothing at all, not merely that it returns an error.
"""

import io

import pytest
from fastapi import HTTPException
from sqlmodel import select

from lib_softtrack import rules as rules_service
from lib_softtrack.models.tickets import MAX_BULK_TICKETS
from lib_softtrack.storage import ObjectNotFound
from lib_softtrack.tables import Attachment, TicketEvent, Notification

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture
def board(client, team, auth):
    """A team with a second member, two labels and three tickets."""
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

    def ticket(title, **fields):
        response = client.post(
            f"/teams/{team_id}/tickets",
            json={"title": title, **fields},
            headers=team["headers"],
        )
        assert response.status_code == 200, response.text
        return response.json()

    tickets = [
        ticket("one", label_ids=[bug["id"]]),
        ticket("two", label_ids=[chore["id"]]),
        ticket("three", assignee_id=team["user"]["id"]),
    ]
    return {
        **team,
        "team_id": team_id,
        "member": member,
        "bug": bug,
        "chore": chore,
        "tickets": tickets,
        "ids": [row["id"] for row in tickets],
    }


def bulk_update(client, board, ticket_ids, **changes):
    return client.post(
        f"/teams/{board['team_id']}/tickets/bulk-update",
        json={"ticket_ids": ticket_ids, "changes": changes},
        headers=board["headers"],
    )


def bulk_delete(client, board, ticket_ids, headers=None):
    return client.post(
        f"/teams/{board['team_id']}/tickets/bulk-delete",
        json={"ticket_ids": ticket_ids},
        headers=headers or board["headers"],
    )


def fetch(client, board, ticket_id):
    return client.get(f"/tickets/{ticket_id}", headers=board["headers"])


def other_team(client, auth):
    outsider = auth(email="other@softtrack.dev", full_name="Other Team")
    created = client.post(
        "/teams", json={"name": "Design", "key": "DES"}, headers=outsider["headers"]
    ).json()
    return {**outsider, "team": created}


# --- bulk update -------------------------------------------------------


def test_one_request_changes_every_ticket(client, board):
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
    for ticket_id in board["ids"]:
        assert fetch(client, board, ticket_id).json()["priority"] == "urgent"


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


def test_setting_project_and_sprint(client, board):
    project = client.post(
        f"/teams/{board['team_id']}/projects",
        json={"name": "Launch"},
        headers=board["headers"],
    ).json()
    sprint = client.post(
        f"/teams/{board['team_id']}/sprints",
        json={"starts_at": "2026-01-01T00:00:00Z", "ends_at": "2026-01-15T00:00:00Z"},
        headers=board["headers"],
    ).json()

    response = bulk_update(
        client, board, board["ids"], project_id=project["id"], sprint_id=sprint["id"]
    )
    assert response.status_code == 200, response.text
    assert {row["project_id"] for row in response.json()} == {project["id"]}
    assert {row["sprint_id"] for row in response.json()} == {sprint["id"]}


def test_each_ticket_gets_its_own_history(client, board, session):
    bulk_update(client, board, board["ids"], status_id=board["status_ids"]["Done"])

    moved = session.exec(
        select(TicketEvent.ticket_id).where(
            TicketEvent.ticket_id.in_(board["ids"]), TicketEvent.old_value.is_not(None)
        )
    ).all()
    assert sorted(moved) == sorted(board["ids"])


def test_each_newly_assigned_ticket_notifies_the_assignee(client, board, session):
    member_id = board["member"]["user"]["id"]
    bulk_update(client, board, board["ids"], assignee_id=member_id)

    notified = session.exec(
        select(Notification.ticket_id).where(Notification.user_id == member_id)
    ).all()
    assert sorted(notified) == sorted(board["ids"])


def test_duplicate_ids_are_changed_once(client, board):
    ids = [board["ids"][0], board["ids"][0]]
    response = bulk_update(client, board, ids, priority="high")
    assert response.status_code == 200, response.text
    assert [row["id"] for row in response.json()] == [board["ids"][0]]


# --- all or nothing ----------------------------------------------------


def test_a_ticket_from_another_team_fails_the_whole_batch(client, board, auth):
    theirs = other_team(client, auth)
    foreign = client.post(
        f"/teams/{theirs['team']['id']}/tickets",
        json={"title": "not yours"},
        headers=theirs["headers"],
    ).json()

    response = bulk_update(
        client, board, [*board["ids"], foreign["id"]], priority="urgent"
    )
    assert response.status_code == 404
    assert str(foreign["id"]) in response.json()["detail"]
    for ticket_id in board["ids"]:
        assert fetch(client, board, ticket_id).json()["priority"] != "urgent"


def test_a_status_from_another_team_is_rejected(client, board, auth):
    theirs = other_team(client, auth)
    their_done = client.get(
        f"/teams/{theirs['team']['id']}/statuses", headers=theirs["headers"]
    ).json()[0]["id"]

    response = bulk_update(client, board, board["ids"], status_id=their_done)
    assert response.status_code == 400


@pytest.mark.parametrize("field", ["project", "sprint", "label"])
def test_a_project_sprint_or_label_from_another_team_is_rejected(
    client, board, auth, field
):
    theirs = other_team(client, auth)
    base = f"/teams/{theirs['team']['id']}"
    if field == "project":
        row = client.post(
            f"{base}/projects", json={"name": "Theirs"}, headers=theirs["headers"]
        ).json()
        changes = {"project_id": row["id"]}
    elif field == "sprint":
        row = client.post(
            f"{base}/sprints",
            json={
                "starts_at": "2026-01-01T00:00:00Z",
                "ends_at": "2026-01-15T00:00:00Z",
            },
            headers=theirs["headers"],
        ).json()
        changes = {"sprint_id": row["id"]}
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


def test_a_failure_partway_through_rolls_back_the_tickets_before_it(
    client, board, monkeypatch
):
    """The transactional guarantee itself.

    The first two tickets are fully applied -- history, notifications, rules --
    before the third fails. None of it may survive.
    """
    real = rules_service.on_ticket_updated
    calls = []

    def fail_on_the_third(session, ticket, before, actor):
        calls.append(ticket.id)
        if len(calls) == 3:
            raise HTTPException(status_code=409, detail="simulated failure")
        real(session, ticket, before, actor)

    monkeypatch.setattr(rules_service, "on_ticket_updated", fail_on_the_third)

    response = bulk_update(client, board, board["ids"], priority="urgent")
    assert response.status_code == 409
    assert len(calls) == 3

    monkeypatch.setattr(rules_service, "on_ticket_updated", real)
    for ticket_id in board["ids"]:
        assert fetch(client, board, ticket_id).json()["priority"] == "no_priority"


def test_a_non_member_cannot_bulk_edit(client, board, auth):
    outsider = auth(email="outsider@softtrack.dev", full_name="Outsider")
    response = client.post(
        f"/teams/{board['team_id']}/tickets/bulk-update",
        json={"ticket_ids": board["ids"], "changes": {"priority": "urgent"}},
        headers=outsider["headers"],
    )
    assert response.status_code == 403


@pytest.mark.parametrize("count", [0, MAX_BULK_TICKETS + 1])
def test_the_batch_size_is_bounded(client, board, count):
    response = bulk_update(client, board, list(range(1, count + 1)), priority="low")
    assert response.status_code == 422


# --- bulk delete -------------------------------------------------------


def test_bulk_delete_moves_every_ticket_to_the_trash(client, board):
    response = bulk_delete(client, board, board["ids"][:2])
    assert response.status_code == 204, response.text

    # 410, not 404: they are in the trash (#323).
    assert fetch(client, board, board["ids"][0]).status_code == 410
    assert fetch(client, board, board["ids"][1]).status_code == 410
    assert fetch(client, board, board["ids"][2]).status_code == 200


@pytest.mark.parametrize("parent_first", [True, False])
def test_a_parent_and_its_sub_ticket_can_go_together(client, board, parent_first):
    parent = board["tickets"][0]
    child = client.post(
        f"/teams/{board['team_id']}/tickets",
        json={"title": "child", "parent_id": parent["id"]},
        headers=board["headers"],
    ).json()
    ids = [parent["id"], child["id"]]

    response = bulk_delete(client, board, ids if parent_first else ids[::-1])
    assert response.status_code == 204, response.text
    assert fetch(client, board, child["id"]).status_code == 410


def test_attachments_of_a_bulk_delete_go_when_it_is_purged(
    client, board, storage, session
):
    ticket = board["tickets"][0]
    uploaded = client.post(
        f"/tickets/{ticket['id']}/attachments",
        files={"file": ("shot.png", io.BytesIO(PNG), "image/png")},
        headers=board["headers"],
    ).json()
    key = session.get(Attachment, uploaded["id"]).storage_key

    assert bulk_delete(client, board, [ticket["id"]]).status_code == 204
    # Kept while it is in the trash, so restoring it brings them back (#323).
    with storage.open(key):
        pass
    purged = client.delete(f"/trash/tickets/{ticket['id']}", headers=board["headers"])
    assert purged.status_code == 204, purged.text
    with pytest.raises(ObjectNotFound):
        storage.open(key)


def test_bulk_delete_with_a_foreign_ticket_deletes_nothing(client, board, auth):
    theirs = other_team(client, auth)
    foreign = client.post(
        f"/teams/{theirs['team']['id']}/tickets",
        json={"title": "not yours"},
        headers=theirs["headers"],
    ).json()

    response = bulk_delete(client, board, [*board["ids"], foreign["id"]])
    assert response.status_code == 404
    for ticket_id in board["ids"]:
        assert fetch(client, board, ticket_id).status_code == 200
    assert (
        client.get(f"/tickets/{foreign['id']}", headers=theirs["headers"]).status_code
        == 200
    )


def test_a_non_member_cannot_bulk_delete(client, board, auth):
    outsider = auth(email="outsider@softtrack.dev", full_name="Outsider")
    response = bulk_delete(client, board, board["ids"], headers=outsider["headers"])
    assert response.status_code == 403
    assert fetch(client, board, board["ids"][0]).status_code == 200

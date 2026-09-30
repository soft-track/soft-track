"""The trash (#323): deleting stops being the end, and stops being anybody's.

Deleting moves a ticket or an epic to the trash with everything it has. It
leaves every board, list, search, count and report, a link to it says who
deleted it, restoring brings all of it back, and it is purged after the
trash's retention -- or sooner, by a team admin.
"""

import io
from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import select

from lib_softtrack import deleting
from lib_softtrack.storage import ObjectNotFound
from lib_softtrack.tables import (
    Attachment,
    AutomationRule,
    Comment,
    Project,
    SavedView,
    Ticket,
    TicketEvent,
    TicketEventField,
    TicketLink,
    WebhookDelivery,
)
from lib_softtrack.trash import INCLUDE_TRASHED

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
PUBLIC = "https://93.184.216.34/hook"


@pytest.fixture
def crew(client, team, auth):
    """ENG with its admin, and two members: Mei, who files tickets, and Ravi."""
    team_id = team["team"]["id"]

    def join(email, name):
        person = auth(email=email, full_name=name)
        response = client.post(
            f"/teams/{team_id}/members",
            json={"email": email},
            headers=team["headers"],
        )
        assert response.status_code == 200, response.text
        return person

    return {
        **team,
        "team_id": team_id,
        "mei": join("mei@softtrack.dev", "Mei Tanaka"),
        "ravi": join("ravi@softtrack.dev", "Ravi Patel"),
    }


def make(client, crew, actor=None, **fields):
    response = client.post(
        f"/teams/{crew['team_id']}/tickets",
        json={"title": "Portal: export statements as CSV", **fields},
        headers=(actor or crew)["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def delete(client, actor, ticket):
    return client.delete(f"/tickets/{ticket['id']}", headers=actor["headers"])


def restore(client, actor, ticket):
    return client.post(
        f"/trash/tickets/{ticket['id']}/restore", headers=actor["headers"]
    )


def trash(client, crew, actor=None):
    response = client.get(
        f"/teams/{crew['team_id']}/trash", headers=(actor or crew)["headers"]
    )
    assert response.status_code == 200, response.text
    return response.json()


def listed(client, crew):
    return [
        ticket["title"]
        for ticket in client.get(
            f"/teams/{crew['team_id']}/tickets", headers=crew["headers"]
        ).json()["items"]
    ]


# --- what deleting does -----------------------------------------------------------


def test_a_deleted_ticket_leaves_the_board_and_a_link_to_it_says_so(client, crew):
    ticket = make(client, crew, actor=crew["mei"])
    assert delete(client, crew["mei"], ticket).status_code == 204

    assert listed(client, crew) == []
    gone = client.get(f"/tickets/{ticket['id']}", headers=crew["headers"])
    assert gone.status_code == 410
    # Not kept by the browser: restoring it has to be seen at once.
    assert gone.headers["cache-control"] == "no-store"
    assert gone.json() == {
        "detail": f"ENG-{ticket['number']} is in the trash",
        "code": "ticket_in_trash",
    }
    by_number = client.get(
        f"/teams/{crew['team_id']}/tickets/by-number/{ticket['number']}",
        headers=crew["headers"],
    )
    assert by_number.status_code == 410

    said = client.get(
        f"/teams/{crew['team_id']}/trash/tickets/{ticket['number']}",
        headers=crew["headers"],
    ).json()
    assert said["identifier"] == f"ENG-{ticket['number']}"
    assert said["deleted_by"]["full_name"] == "Mei Tanaka"
    deleted_at = datetime.fromisoformat(said["deleted_at"])
    assert datetime.fromisoformat(said["purge_at"]) - deleted_at == timedelta(days=30)


def test_it_leaves_search_counts_links_and_its_parent(client, crew):
    parent = make(client, crew, title="Statements")
    doomed = make(client, crew, title="Zeppelin export", parent_id=parent["id"])
    make(client, crew, title="Keep me", parent_id=parent["id"])
    blocked = make(client, crew, title="Blocked by it")
    client.post(
        f"/tickets/{doomed['id']}/links",
        json={"target_id": blocked["id"], "type": "blocks"},
        headers=crew["headers"],
    )
    assert (
        client.get(f"/tickets/{blocked['id']}", headers=crew["headers"]).json()[
            "blocked_by_count"
        ]
        == 1
    )

    delete(client, crew, doomed)

    found = client.get(
        "/search", params={"q": "zeppelin"}, headers=crew["headers"]
    ).json()
    assert found["items"] == []
    after = client.get(f"/tickets/{parent['id']}", headers=crew["headers"]).json()
    assert after["child_count"] == 1
    blocked_now = client.get(
        f"/tickets/{blocked['id']}", headers=crew["headers"]
    ).json()
    assert blocked_now["blocked_by_count"] == 0
    links = client.get(
        f"/tickets/{blocked['id']}/links", headers=crew["headers"]
    ).json()
    assert str(doomed["id"]) not in str(links)


def test_it_leaves_the_reports(client, crew):
    """Reports replay history, so its history leaves them too."""
    done = crew["status_ids"]["Done"]
    doomed = make(client, crew)
    client.patch(
        f"/tickets/{doomed['id']}", json={"status_id": done}, headers=crew["headers"]
    )

    def resolved_today():
        report = client.get(
            f"/teams/{crew['team_id']}/created-vs-resolved",
            headers=crew["headers"],
        ).json()
        return report["total_resolved"]

    assert resolved_today() == 1
    delete(client, crew, doomed)
    assert resolved_today() == 0


def test_deleting_is_in_the_history_and_sent_to_webhooks(client, crew, session):
    client.post(
        f"/teams/{crew['team_id']}/outbound-webhooks",
        json={"url": PUBLIC, "events": ["ticket.deleted", "ticket.restored"]},
        headers=crew["headers"],
    )
    ticket = make(client, crew)
    delete(client, crew, ticket)
    restore(client, crew, ticket)

    events = session.exec(
        select(TicketEvent)
        .where(
            TicketEvent.ticket_id == ticket["id"],
            TicketEvent.field == TicketEventField.trash,
        )
        .order_by(TicketEvent.id)
    ).all()
    assert [(e.old_value is None, e.new_value is None) for e in events] == [
        (True, False),
        (False, True),
    ]
    assert [d.event for d in session.exec(select(WebhookDelivery)).all()] == [
        "ticket.deleted",
        "ticket.restored",
    ]


# --- restoring ----------------------------------------------------------------------


def test_restoring_brings_back_everything_it_had(client, crew, session, storage):
    ticket = make(client, crew)
    other = make(client, crew, title="Other")
    client.post(
        f"/tickets/{ticket['id']}/comments",
        json={"body": "See the CSV spec"},
        headers=crew["headers"],
    )
    client.post(
        f"/tickets/{ticket['id']}/links",
        json={"target_id": other["id"], "type": "relates_to"},
        headers=crew["headers"],
    )
    uploaded = client.post(
        f"/tickets/{ticket['id']}/attachments",
        files={"file": ("spec.png", io.BytesIO(PNG), "image/png")},
        headers=crew["headers"],
    ).json()
    key = session.get(Attachment, uploaded["id"]).storage_key

    delete(client, crew, ticket)
    # Nothing was taken away while it was in there.
    with storage.open(key):
        pass
    response = restore(client, crew["ravi"], ticket)
    assert response.status_code == 200, response.text
    assert response.json()["id"] == ticket["id"]

    assert listed(client, crew) == ["Other", "Portal: export statements as CSV"]
    comments = client.get(
        f"/tickets/{ticket['id']}/comments", headers=crew["headers"]
    ).json()
    assert [c["body"] for c in comments["items"]] == ["See the CSV spec"]
    assert session.exec(select(TicketLink)).one().target_id == other["id"]
    assert trash(client, crew)["tickets"] == []


def test_restoring_a_ticket_that_is_not_in_the_trash_says_so(client, crew):
    ticket = make(client, crew)
    response = restore(client, crew, ticket)
    assert response.status_code == 404
    assert response.json()["code"] == "not_in_trash"


def test_a_guest_cannot_restore(client, crew, auth):
    guest = auth(email="client@example.com", full_name="Carol Client")
    client.post(
        f"/teams/{crew['team_id']}/members",
        json={"email": "client@example.com", "role": "guest"},
        headers=crew["headers"],
    )
    ticket = make(client, crew)
    delete(client, crew, ticket)
    assert restore(client, guest, ticket).status_code == 403
    # And the trash is theirs to read, as the board is.
    assert [t["id"] for t in trash(client, crew, guest)["tickets"]] == [ticket["id"]]


# --- who may delete ------------------------------------------------------------------


def test_a_new_team_leaves_deleting_to_the_creator_and_its_admins(client, crew):
    assert crew["team"]["any_member_may_delete"] is False
    hers = make(client, crew, actor=crew["mei"])

    refused = delete(client, crew["ravi"], hers)
    assert refused.status_code == 403
    assert refused.json()["code"] == "not_allowed_to_delete"
    assert delete(client, crew["mei"], hers).status_code == 204
    # The admin deletes anybody's.
    assert (
        delete(client, crew, make(client, crew, actor=crew["mei"])).status_code == 204
    )


def test_a_team_can_let_every_member_delete(client, crew):
    response = client.patch(
        f"/teams/{crew['team_id']}",
        json={"any_member_may_delete": True},
        headers=crew["headers"],
    )
    assert response.json()["any_member_may_delete"] is True
    hers = make(client, crew, actor=crew["mei"])
    assert delete(client, crew["ravi"], hers).status_code == 204


def test_only_an_admin_changes_who_may_delete(client, crew):
    response = client.patch(
        f"/teams/{crew['team_id']}",
        json={"any_member_may_delete": True},
        headers=crew["mei"]["headers"],
    )
    assert response.status_code == 403


def test_a_bulk_delete_holding_one_that_is_not_theirs_deletes_nothing(client, crew):
    mine = make(client, crew, actor=crew["ravi"], title="Mine")
    hers = make(client, crew, actor=crew["mei"], title="Hers")
    response = client.post(
        f"/teams/{crew['team_id']}/tickets/bulk-delete",
        json={"ticket_ids": [mine["id"], hers["id"]]},
        headers=crew["ravi"]["headers"],
    )
    assert response.status_code == 403
    assert sorted(listed(client, crew)) == ["Hers", "Mine"]


# --- purging -------------------------------------------------------------------------


def test_an_admin_deletes_forever_with_everything_it_had(
    client, crew, session, storage
):
    parent = make(client, crew, title="Parent")
    child = make(client, crew, title="Child", parent_id=parent["id"])
    client.post(
        f"/tickets/{parent['id']}/comments",
        json={"body": "gone soon"},
        headers=crew["headers"],
    )
    uploaded = client.post(
        f"/tickets/{parent['id']}/attachments",
        files={"file": ("spec.png", io.BytesIO(PNG), "image/png")},
        headers=crew["headers"],
    ).json()
    key = session.get(Attachment, uploaded["id"]).storage_key
    delete(client, crew, parent)

    refused = client.delete(
        f"/trash/tickets/{parent['id']}", headers=crew["mei"]["headers"]
    )
    assert refused.status_code == 403
    purged = client.delete(f"/trash/tickets/{parent['id']}", headers=crew["headers"])
    assert purged.status_code == 204, purged.text

    session.expire_all()
    assert session.get(Ticket, parent["id"], execution_options=INCLUDE_TRASHED) is None
    assert session.exec(select(Comment)).all() == []
    with pytest.raises(ObjectNotFound):
        storage.open(key)
    # Its sub-ticket is kept, at the top level.
    assert session.get(Ticket, child["id"]).parent_id is None
    assert (
        client.get(f"/tickets/{parent['id']}", headers=crew["headers"]).status_code
        == 404
    )


def test_a_purge_reaches_a_trashed_child_too(client, crew, session, storage):
    """Both in the trash: the child still points at its parent, and the
    purge has to let go of it or the parent row could not go."""
    parent = make(client, crew, title="Parent")
    child = make(client, crew, title="Child", parent_id=parent["id"])
    delete(client, crew, child)
    delete(client, crew, parent)

    purged = client.delete(f"/trash/tickets/{parent['id']}", headers=crew["headers"])
    assert purged.status_code == 204, purged.text
    # Restored, the child comes back at the top level.
    assert restore(client, crew, child).json()["parent"] is None


def test_the_trash_is_purged_after_thirty_days(client, crew, session, storage):
    old = make(client, crew, title="Old")
    recent = make(client, crew, title="Recent")
    delete(client, crew, old)
    delete(client, crew, recent)
    moved = session.get(Ticket, old["id"], execution_options=INCLUDE_TRASHED)
    moved.deleted_at = datetime.now(timezone.utc) - timedelta(days=31)
    session.add(moved)
    session.commit()

    assert deleting.purge_expired(session, storage) == 1

    assert [t["title"] for t in trash(client, crew)["tickets"]] == ["Recent"]


# --- epics ------------------------------------------------------------------------------


@pytest.fixture
def epic(client, crew):
    project = client.post(
        f"/teams/{crew['team_id']}/projects",
        json={"name": "Customer portal"},
        headers=crew["headers"],
    ).json()
    tickets = [
        make(client, crew, title=f"Portal {n}", project_id=project["id"])
        for n in (1, 2)
    ]
    return {"project": project, "tickets": tickets}


def epics_listed(client, crew):
    return [
        p["name"]
        for p in client.get(
            f"/teams/{crew['team_id']}/projects", headers=crew["headers"]
        ).json()
    ]


def test_a_restored_epic_gets_its_tickets_back(client, crew, epic):
    project = epic["project"]
    assert (
        client.delete(f"/projects/{project['id']}", headers=crew["headers"]).status_code
        == 204
    )
    assert epics_listed(client, crew) == []
    [row] = trash(client, crew)["epics"]
    assert (row["name"], row["ticket_count"]) == ("Customer portal", 2)
    # Its tickets stay on the board meanwhile, and cannot be put in it.
    assert sorted(listed(client, crew)) == ["Portal 1", "Portal 2"]
    refused = client.post(
        f"/teams/{crew['team_id']}/tickets",
        json={"title": "More", "project_id": project["id"]},
        headers=crew["headers"],
    )
    assert refused.status_code == 400

    restored = client.post(
        f"/trash/projects/{project['id']}/restore", headers=crew["headers"]
    )
    assert restored.status_code == 200, restored.text
    assert epics_listed(client, crew) == ["Customer portal"]
    assert restored.json()["ticket_count"] == 2


def test_a_member_deletes_an_epic_they_lead_but_not_another(client, crew, epic):
    led = client.post(
        f"/teams/{crew['team_id']}/projects",
        json={"name": "Billing", "lead_id": crew["mei"]["user"]["id"]},
        headers=crew["headers"],
    ).json()
    assert (
        client.delete(
            f"/projects/{epic['project']['id']}", headers=crew["mei"]["headers"]
        ).status_code
        == 403
    )
    assert (
        client.delete(
            f"/projects/{led['id']}", headers=crew["mei"]["headers"]
        ).status_code
        == 204
    )


def test_purging_an_epic_lets_its_tickets_views_and_rules_go(
    client, crew, epic, session
):
    project = epic["project"]
    client.post(
        f"/teams/{crew['team_id']}/views",
        json={
            "name": "Portal work",
            "is_shared": True,
            "filters": {"project_id": project["id"]},
        },
        headers=crew["headers"],
    )
    client.post(
        f"/teams/{crew['team_id']}/automation-rules",
        json={
            "name": "Portal is urgent",
            "trigger": "ticket_created",
            "conditions": {"if_project_id": project["id"]},
            "actions": {"set_priority": "urgent"},
        },
        headers=crew["headers"],
    )
    client.delete(f"/projects/{project['id']}", headers=crew["headers"])
    purged = client.delete(f"/trash/projects/{project['id']}", headers=crew["headers"])
    assert purged.status_code == 204, purged.text

    session.expire_all()
    assert (
        session.get(Project, project["id"], execution_options=INCLUDE_TRASHED) is None
    )
    for ticket in epic["tickets"]:
        assert session.get(Ticket, ticket["id"]).project_id is None
    assert session.exec(select(SavedView)).one().project_id is None
    rule = session.exec(select(AutomationRule)).one()
    assert rule.is_enabled is False


# --- what must reach the trash, too ------------------------------------------------------


def test_a_status_can_go_while_a_trashed_ticket_is_in_it(client, crew, session):
    """Its tickets move to another status, the trashed ones too: they hold
    the foreign key all the same."""
    status = client.post(
        f"/teams/{crew['team_id']}/statuses",
        json={"name": "QA", "category": "started"},
        headers=crew["headers"],
    ).json()
    ticket = make(client, crew, status_id=status["id"])
    delete(client, crew, ticket)

    response = client.request(
        "DELETE",
        f"/statuses/{status['id']}",
        json={"move_to_id": crew["status_ids"]["Todo"]},
        headers=crew["headers"],
    )
    assert response.status_code == 200, response.text
    moved = session.get(Ticket, ticket["id"], execution_options=INCLUDE_TRASHED)
    assert moved.status_id == crew["status_ids"]["Todo"]


def test_a_sprint_can_go_while_a_trashed_ticket_is_in_it(client, crew, session):
    start = datetime.now(timezone.utc)
    sprint = client.post(
        f"/teams/{crew['team_id']}/sprints",
        json={
            "name": "Sprint 14",
            "starts_at": start.isoformat(),
            "ends_at": (start + timedelta(days=14)).isoformat(),
        },
        headers=crew["headers"],
    ).json()
    ticket = make(client, crew, sprint_id=sprint["id"])
    delete(client, crew, ticket)

    response = client.delete(f"/sprints/{sprint['id']}", headers=crew["headers"])
    assert response.status_code == 204, response.text
    moved = session.get(Ticket, ticket["id"], execution_options=INCLUDE_TRASHED)
    assert moved.sprint_id is None

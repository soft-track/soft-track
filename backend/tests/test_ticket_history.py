"""A ticket's own history, as its Activity feed shows it (issue #81).

The events were already recorded for the reports; what these pin is the read
side -- changes rather than opening values, names rather than ids, the actor,
and the cap -- and the two fields newly worth recording, assignee and
priority.
"""

from datetime import datetime, timedelta, timezone

from sqlmodel import select

from lib_softtrack.history import EVENT_LIMIT
from lib_softtrack.tables import Ticket


def make_ticket(client, team, title="Work", **fields):
    response = client.post(
        f"/teams/{team['team']['id']}/tickets",
        json={"title": title, **fields},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def patch(client, team, ticket, **fields):
    response = client.patch(
        f"/tickets/{ticket['id']}", json=fields, headers=team["headers"]
    )
    assert response.status_code == 200, response.text
    return response.json()


def events(client, team, ticket):
    response = client.get(f"/tickets/{ticket['id']}/events", headers=team["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def moves(client, team, ticket):
    return [
        (e["field"], e["old_value"], e["new_value"])
        for e in events(client, team, ticket)
    ]


def test_a_new_ticket_has_no_history_yet(client, team):
    """The values it was created with are where it started, not changes."""
    ticket = make_ticket(
        client, team, priority="high", estimate=3, assignee_id=team["user"]["id"]
    )
    assert events(client, team, ticket) == []


def test_a_status_change_says_who_and_between_which_categories(client, team):
    ticket = make_ticket(client, team)
    patch(client, team, ticket, status_id=team["status_ids"]["Done"])

    [event] = events(client, team, ticket)
    assert (event["field"], event["old_value"], event["new_value"]) == (
        "status",
        "backlog",
        "done",
    )
    assert event["actor"]["id"] == team["user"]["id"]
    assert event["created_at"]


def test_assignee_and_priority_changes_are_recorded(client, team):
    ticket = make_ticket(client, team)
    patch(client, team, ticket, priority="urgent")
    patch(client, team, ticket, assignee_id=team["user"]["id"])
    patch(client, team, ticket, assignee_id=None)

    assert moves(client, team, ticket) == [
        ("priority", "no_priority", "urgent"),
        ("assignee", None, str(team["user"]["id"])),
        ("assignee", str(team["user"]["id"]), None),
    ]


def test_ids_come_back_with_the_names_they_stand_for(client, team):
    team_id = team["team"]["id"]
    project = client.post(
        f"/teams/{team_id}/projects", json={"name": "Platform"}, headers=team["headers"]
    ).json()
    sprint = client.post(
        f"/teams/{team_id}/sprints",
        json={"starts_at": "2026-09-01", "ends_at": "2026-09-14"},
        headers=team["headers"],
    )
    assert sprint.status_code == 200, sprint.text
    ticket = make_ticket(client, team)
    patch(client, team, ticket, assignee_id=team["user"]["id"])
    patch(client, team, ticket, project_id=project["id"])
    patch(client, team, ticket, sprint_id=sprint.json()["id"])

    labels = {e["field"]: e["new_label"] for e in events(client, team, ticket)}
    assert labels == {
        "assignee": team["user"]["full_name"],
        "project": "Platform",
        "sprint": sprint.json()["display_name"],
    }


def test_a_deleted_projects_name_is_gone_but_the_event_is_not(client, team):
    project = client.post(
        f"/teams/{team['team']['id']}/projects",
        json={"name": "Doomed"},
        headers=team["headers"],
    ).json()
    ticket = make_ticket(client, team)
    patch(client, team, ticket, project_id=project["id"])
    client.delete(f"/projects/{project['id']}", headers=team["headers"])

    joined, left = events(client, team, ticket)
    assert (joined["new_value"], joined["new_label"]) == (str(project["id"]), None)
    assert (left["old_value"], left["new_value"]) == (str(project["id"]), None)


def test_setting_a_field_to_what_it_already_is_is_not_history(client, team):
    ticket = make_ticket(client, team, priority="high")
    patch(client, team, ticket, priority="high")
    assert events(client, team, ticket) == []


def test_an_imported_ticket_hides_its_opening_values_too(client, team, session):
    """An import back-dates `created_at` to the Jira date, while its opening
    events are written at import time -- so "near creation" has to be
    measured from the first event, not from the ticket."""
    ticket = make_ticket(client, team, priority="low")
    row = session.get(Ticket, ticket["id"])
    row.created_at = datetime.now(timezone.utc) - timedelta(days=400)
    session.add(row)
    session.commit()

    assert events(client, team, ticket) == []
    patch(client, team, ticket, priority="high")
    assert moves(client, team, ticket) == [("priority", "low", "high")]


def test_the_latest_changes_come_back_oldest_first_up_to_the_cap(client, team):
    ticket = make_ticket(client, team)
    priorities = ["low", "high"]
    for n in range(EVENT_LIMIT + 5):
        patch(client, team, ticket, priority=priorities[n % 2])

    history = events(client, team, ticket)
    assert len(history) == EVENT_LIMIT
    ids = [e["id"] for e in history]
    assert ids == sorted(ids)
    # The newest change is last; the oldest five were the ones dropped.
    assert history[-1]["new_value"] == priorities[(EVENT_LIMIT + 4) % 2]


def test_only_team_members_can_read_a_tickets_history(client, team, auth):
    ticket = make_ticket(client, team)
    outsider = auth(email="outsider@softtrack.dev", full_name="Outsider")
    response = client.get(
        f"/tickets/{ticket['id']}/events", headers=outsider["headers"]
    )
    assert response.status_code == 403


def test_a_missing_ticket_is_a_404(client, team):
    response = client.get("/tickets/999999/events", headers=team["headers"])
    assert response.status_code == 404

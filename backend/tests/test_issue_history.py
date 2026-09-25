"""An issue's own history, as its Activity feed shows it (issue #81).

The events were already recorded for the reports; what these pin is the read
side -- changes rather than opening values, names rather than ids, the actor,
and the cap -- and the two fields newly worth recording, assignee and
priority.
"""

from datetime import datetime, timedelta, timezone

from sqlmodel import select

from lib_softtrack.history import EVENT_LIMIT
from lib_softtrack.tables import Issue


def make_issue(client, team, title="Work", **fields):
    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": title, **fields},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def patch(client, team, issue, **fields):
    response = client.patch(
        f"/issues/{issue['id']}", json=fields, headers=team["headers"]
    )
    assert response.status_code == 200, response.text
    return response.json()


def events(client, team, issue):
    response = client.get(f"/issues/{issue['id']}/events", headers=team["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def moves(client, team, issue):
    return [
        (e["field"], e["old_value"], e["new_value"])
        for e in events(client, team, issue)
    ]


def test_a_new_issue_has_no_history_yet(client, team):
    """The values it was created with are where it started, not changes."""
    issue = make_issue(
        client, team, priority="high", estimate=3, assignee_id=team["user"]["id"]
    )
    assert events(client, team, issue) == []


def test_a_status_change_says_who_and_between_which_categories(client, team):
    issue = make_issue(client, team)
    patch(client, team, issue, status_id=team["status_ids"]["Done"])

    [event] = events(client, team, issue)
    assert (event["field"], event["old_value"], event["new_value"]) == (
        "status",
        "backlog",
        "done",
    )
    assert event["actor"]["id"] == team["user"]["id"]
    assert event["created_at"]


def test_assignee_and_priority_changes_are_recorded(client, team):
    issue = make_issue(client, team)
    patch(client, team, issue, priority="urgent")
    patch(client, team, issue, assignee_id=team["user"]["id"])
    patch(client, team, issue, assignee_id=None)

    assert moves(client, team, issue) == [
        ("priority", "no_priority", "urgent"),
        ("assignee", None, str(team["user"]["id"])),
        ("assignee", str(team["user"]["id"]), None),
    ]


def test_ids_come_back_with_the_names_they_stand_for(client, team):
    team_id = team["team"]["id"]
    project = client.post(
        f"/teams/{team_id}/projects", json={"name": "Platform"}, headers=team["headers"]
    ).json()
    cycle = client.post(
        f"/teams/{team_id}/cycles",
        json={"starts_at": "2026-09-01", "ends_at": "2026-09-14"},
        headers=team["headers"],
    )
    assert cycle.status_code == 200, cycle.text
    issue = make_issue(client, team)
    patch(client, team, issue, assignee_id=team["user"]["id"])
    patch(client, team, issue, project_id=project["id"])
    patch(client, team, issue, cycle_id=cycle.json()["id"])

    labels = {e["field"]: e["new_label"] for e in events(client, team, issue)}
    assert labels == {
        "assignee": team["user"]["full_name"],
        "project": "Platform",
        "cycle": cycle.json()["display_name"],
    }


def test_a_deleted_projects_name_is_gone_but_the_event_is_not(client, team):
    project = client.post(
        f"/teams/{team['team']['id']}/projects",
        json={"name": "Doomed"},
        headers=team["headers"],
    ).json()
    issue = make_issue(client, team)
    patch(client, team, issue, project_id=project["id"])
    client.delete(f"/projects/{project['id']}", headers=team["headers"])

    joined, left = events(client, team, issue)
    assert (joined["new_value"], joined["new_label"]) == (str(project["id"]), None)
    assert (left["old_value"], left["new_value"]) == (str(project["id"]), None)


def test_setting_a_field_to_what_it_already_is_is_not_history(client, team):
    issue = make_issue(client, team, priority="high")
    patch(client, team, issue, priority="high")
    assert events(client, team, issue) == []


def test_an_imported_issue_hides_its_opening_values_too(client, team, session):
    """An import back-dates `created_at` to the Jira date, while its opening
    events are written at import time -- so "near creation" has to be
    measured from the first event, not from the issue."""
    issue = make_issue(client, team, priority="low")
    row = session.get(Issue, issue["id"])
    row.created_at = datetime.now(timezone.utc) - timedelta(days=400)
    session.add(row)
    session.commit()

    assert events(client, team, issue) == []
    patch(client, team, issue, priority="high")
    assert moves(client, team, issue) == [("priority", "low", "high")]


def test_the_latest_changes_come_back_oldest_first_up_to_the_cap(client, team):
    issue = make_issue(client, team)
    priorities = ["low", "high"]
    for n in range(EVENT_LIMIT + 5):
        patch(client, team, issue, priority=priorities[n % 2])

    history = events(client, team, issue)
    assert len(history) == EVENT_LIMIT
    ids = [e["id"] for e in history]
    assert ids == sorted(ids)
    # The newest change is last; the oldest five were the ones dropped.
    assert history[-1]["new_value"] == priorities[(EVENT_LIMIT + 4) % 2]


def test_only_team_members_can_read_an_issues_history(client, team, auth):
    issue = make_issue(client, team)
    outsider = auth(email="outsider@softtrack.dev", full_name="Outsider")
    response = client.get(f"/issues/{issue['id']}/events", headers=outsider["headers"])
    assert response.status_code == 403


def test_a_missing_issue_is_a_404(client, team):
    response = client.get("/issues/999999/events", headers=team["headers"])
    assert response.status_code == 404

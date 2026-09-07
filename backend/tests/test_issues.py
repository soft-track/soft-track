import pytest


@pytest.fixture
def issue(client, team):
    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": "Drag and drop issue cards"},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_the_first_issue_gets_identifier_one(issue):
    assert issue["identifier"] == "ENG-1"
    assert issue["number"] == 1


def test_the_identifier_counter_increments_per_team(client, team):
    identifiers = []
    for title in ("first", "second", "third"):
        response = client.post(
            f"/teams/{team['team']['id']}/issues",
            json={"title": title},
            headers=team["headers"],
        )
        identifiers.append(response.json()["identifier"])
    assert identifiers == ["ENG-1", "ENG-2", "ENG-3"]


def test_a_new_issue_defaults_to_backlog_and_no_priority(issue):
    assert issue["status"] == "backlog"
    assert issue["priority"] == "no_priority"
    assert issue["assignee"] is None
    assert issue["labels"] == []


def test_the_creator_is_recorded(issue, team):
    assert issue["creator"]["email"] == team["user"]["email"]


def test_updating_the_status(client, issue, team):
    response = client.patch(
        f"/issues/{issue['id']}",
        json={"status": "in_progress"},
        headers=team["headers"],
    )
    assert response.status_code == 200
    assert response.json()["status"] == "in_progress"


def test_a_partial_update_leaves_other_fields_alone(client, issue, team):
    client.patch(
        f"/issues/{issue['id']}",
        json={"priority": "urgent"},
        headers=team["headers"],
    )
    after = client.get(f"/issues/{issue['id']}", headers=team["headers"]).json()
    assert after["priority"] == "urgent"
    assert after["title"] == "Drag and drop issue cards"


def test_filtering_issues_by_status(client, team, issue):
    client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": "another", "status": "done"},
        headers=team["headers"],
    )
    response = client.get(
        f"/teams/{team['team']['id']}/issues?status=done", headers=team["headers"]
    )
    assert [i["title"] for i in response.json()] == ["another"]


def test_a_label_can_be_attached_at_creation(client, team):
    label = client.post(
        f"/teams/{team['team']['id']}/labels",
        json={"name": "Bug", "color": "#e0424a"},
        headers=team["headers"],
    ).json()
    issue = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": "with a label", "label_ids": [label["id"]]},
        headers=team["headers"],
    ).json()
    assert [l["name"] for l in issue["labels"]] == ["Bug"]


def test_comments_round_trip(client, issue, team):
    created = client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "Looks good to me"},
        headers=team["headers"],
    )
    assert created.status_code == 200
    listed = client.get(f"/issues/{issue['id']}/comments", headers=team["headers"])
    assert [c["body"] for c in listed.json()] == ["Looks good to me"]
    assert listed.json()[0]["author"]["email"] == team["user"]["email"]


def test_an_empty_comment_is_rejected(client, issue, team):
    response = client.post(
        f"/issues/{issue['id']}/comments", json={"body": ""}, headers=team["headers"]
    )
    assert response.status_code == 422


def test_a_missing_issue_is_a_404(client, team):
    assert client.get("/issues/99999", headers=team["headers"]).status_code == 404


def test_a_non_member_cannot_read_an_issue(client, issue, auth):
    outsider = auth(email="outsider@softtrack.dev")
    response = client.get(f"/issues/{issue['id']}", headers=outsider["headers"])
    assert response.status_code == 403


def test_deleting_a_bare_issue(client, issue, team):
    assert (
        client.delete(f"/issues/{issue['id']}", headers=team["headers"]).status_code
        == 204
    )
    assert (
        client.get(f"/issues/{issue['id']}", headers=team["headers"]).status_code == 404
    )

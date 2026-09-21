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
    # A new issue lands in the leftmost column, which is what
    # `backlog` used to mean.
    assert issue["status"]["name"] == "Backlog"
    assert issue["status"]["category"] == "backlog"
    assert issue["priority"] == "no_priority"
    assert issue["assignee"] is None
    assert issue["labels"] == []


def test_the_creator_is_recorded(issue, team):
    assert issue["creator"]["email"] == team["user"]["email"]


def test_updating_the_status(client, issue, team):
    response = client.patch(
        f"/issues/{issue['id']}",
        json={"status_id": team["status_ids"]["In Progress"]},
        headers=team["headers"],
    )
    assert response.status_code == 200
    assert response.json()["status"]["name"] == "In Progress"


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
        json={"title": "another", "status_id": team["status_ids"]["Done"]},
        headers=team["headers"],
    )
    response = client.get(
        f"/teams/{team['team']['id']}/issues"
        f"?status_id={team['status_ids']['Done']}",
        headers=team["headers"],
    )
    body = response.json()
    assert [i["title"] for i in body["items"]] == ["another"]
    assert body["total"] == 1


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
    body = listed.json()
    assert [c["body"] for c in body["items"]] == ["Looks good to me"]
    assert body["items"][0]["author"]["email"] == team["user"]["email"]
    assert body["total"] == 1


def test_an_empty_comment_is_rejected(client, issue, team):
    response = client.post(
        f"/issues/{issue['id']}/comments", json={"body": ""}, headers=team["headers"]
    )
    assert response.status_code == 422


def test_a_missing_issue_is_a_404(client, team):
    assert client.get("/issues/99999", headers=team["headers"]).status_code == 404


def test_an_issue_can_be_read_by_team_number(client, issue, team):
    response = client.get(
        f"/teams/{team['team']['id']}/issues/by-number/{issue['number']}",
        headers=team["headers"],
    )
    assert response.status_code == 200
    assert response.json() == issue


def test_reading_a_number_in_the_wrong_team_is_a_404(client, issue, auth):
    other_user = auth(email="other@softtrack.dev")
    created_team = client.post(
        "/teams",
        json={"name": "Product", "key": "PROD"},
        headers=other_user["headers"],
    ).json()
    response = client.get(
        f"/teams/{created_team['id']}/issues/by-number/{issue['number']}",
        headers=other_user["headers"],
    )
    assert response.status_code == 404


def test_reading_an_issue_from_a_missing_team_is_a_404(client, team):
    response = client.get(
        "/teams/99999/issues/by-number/1",
        headers=team["headers"],
    )
    assert response.status_code == 404


def test_a_non_member_cannot_read_an_issue_by_team_number(client, issue, team, auth):
    outsider = auth(email="number-outsider@softtrack.dev")
    response = client.get(
        f"/teams/{team['team']['id']}/issues/by-number/{issue['number']}",
        headers=outsider["headers"],
    )
    assert response.status_code == 403


def test_a_missing_issue_number_is_a_404(client, team):
    response = client.get(
        f"/teams/{team['team']['id']}/issues/by-number/99999",
        headers=team["headers"],
    )
    assert response.status_code == 404


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


def test_export_issues_csv_basic(client, team):
    # Create an issue with commas, quotes and newlines to test CSV escaping
    special = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={
            "title": 'Title, with comma "quote" and \n newline',
            "description": 'Desc with "quote", comma, and\nnew line',
        },
        headers=team["headers"],
    ).json()

    response = client.get(
        f"/teams/{team['team']['id']}/issues/export", headers=team["headers"]
    )
    assert response.status_code == 200
    assert response.headers.get("content-type", "").split(";")[0] == "text/csv"

    # Ensure BOM present and CSV headers
    assert response.content.startswith(b"\xef\xbb\xbf")
    text = response.content.decode("utf-8-sig")
    import io, csv

    rows = list(csv.reader(io.StringIO(text)))
    assert rows[0] == [
        "key",
        "title",
        "description",
        "status",
        "priority",
        "assignee",
        "labels",
        "project",
        "cycle",
        "estimate",
        "creator",
        "created",
        "updated",
        "parent_key",
    ]

    # Find our special issue row by title
    titles = [r[1] for r in rows[1:]]
    assert any('Title, with comma "quote"' in t for t in titles)

    # `created` and `updated` read as plain spreadsheet dates: no `T`, no
    # microseconds.
    import re

    for row in rows[1:]:
        created, updated = row[11], row[12]
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", created), created
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", updated), updated


def test_non_member_cannot_export(client, issue, auth):
    outsider = auth(email="outsider2@softtrack.dev")
    response = client.get(
        f"/teams/{issue['team_id']}/issues/export", headers=outsider["headers"]
    )
    assert response.status_code == 403


def test_export_timestamps_are_formatted_without_losing_the_stored_value(
    client, issue, team, session
):
    """The CSV is reformatted; the row behind it keeps its full precision."""
    import csv
    import io

    from lib_softtrack.tables import Issue

    stored = session.get(Issue, issue["id"])
    response = client.get(
        f"/teams/{issue['team_id']}/issues/export", headers=team["headers"]
    )
    assert response.status_code == 200

    rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
    row = next(r for r in rows[1:] if r[0] == issue["identifier"])

    assert row[11] == stored.created_at.strftime("%Y-%m-%d %H:%M:%S")
    assert row[12] == stored.updated_at.strftime("%Y-%m-%d %H:%M:%S")
    assert "T" not in row[11] and "." not in row[11]
    # The stored timestamp still carries the microseconds the CSV drops.
    assert stored.created_at.isoformat() != row[11]


def test_export_timestamp_helper_handles_a_missing_value():
    from app_softtrack.issues import _csv_timestamp

    assert _csv_timestamp(None) == ""

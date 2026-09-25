import csv
import io

import pytest
from sqlmodel import Session

from lib_softtrack import issues as issues_service
from lib_softtrack.tables import Issue
from main import app
from web import get_session


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


@pytest.fixture
def export_board(client, team):
    """A team with something in every column an export has.

    A project, a cycle, two labels, an assignee, an estimate and a parent, so
    the one row this returns exercises every mapping rather than the handful
    a bare issue happens to fill in.
    """
    team_id = team["team"]["id"]

    def post(path, payload):
        response = client.post(path, json=payload, headers=team["headers"])
        assert response.status_code == 200, response.text
        return response.json()

    project = post(f"/teams/{team_id}/projects", {"name": "Platform"})
    # Unnamed on purpose: a cycle without a name is shown by its number, and
    # that substitution is part of what the export has to get right.
    cycle = post(
        f"/teams/{team_id}/cycles",
        {"starts_at": "2026-01-05T09:00:00", "ends_at": "2026-01-19T09:00:00"},
    )
    bug = post(f"/teams/{team_id}/labels", {"name": "Bug"})
    chore = post(f"/teams/{team_id}/labels", {"name": "Chore"})
    parent = post(f"/teams/{team_id}/issues", {"title": "Parent issue"})
    child = post(
        f"/teams/{team_id}/issues",
        {
            # Commas, quotes and a newline, so the row also pins the escaping.
            "title": 'Title, with comma "quote" and\na newline',
            "description": 'Desc with "quote", comma, and\nnew line',
            "project_id": project["id"],
            "cycle_id": cycle["id"],
            "label_ids": [bug["id"], chore["id"]],
            "assignee_id": team["user"]["id"],
            "estimate": 5,
            "parent_id": parent["id"],
            "priority": "urgent",
            "status_id": team["status_ids"]["In Progress"],
        },
    )
    return {
        **team,
        "team_id": team_id,
        "project": project,
        "cycle": cycle,
        "parent": parent,
        "child": child,
    }


def export_rows(client, board, query=""):
    """The parsed CSV, header row included."""
    response = client.get(
        f"/teams/{board['team_id']}/issues/export?{query}", headers=board["headers"]
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].split(";")[0] == "text/csv"
    assert response.headers["content-disposition"] == "attachment; filename=issues.csv"
    # Excel reads a BOM-less file as the machine's local codepage.
    assert response.content.startswith(b"\xef\xbb\xbf")
    text = response.content.decode("utf-8-sig")
    assert text.endswith("\r\n")
    return list(csv.reader(io.StringIO(text)))


def test_the_export_header_names_every_column(client, export_board):
    assert export_rows(client, export_board)[0] == [
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


def test_every_column_carries_its_value(client, export_board, session):
    """The whole row, field by field.

    Asserted as one list rather than a substring per column: a mapping that is
    dropped, or moved one place along, has to fail here.
    """
    child = export_board["child"]
    stored = session.get(Issue, child["id"])
    rows = export_rows(client, export_board)
    row = next(r for r in rows[1:] if r[0] == child["identifier"])

    assert row == [
        "ENG-2",
        'Title, with comma "quote" and\na newline',
        'Desc with "quote", comma, and\nnew line',
        "In Progress",
        "urgent",
        export_board["user"]["username"],
        "Bug;Chore",
        "Platform",
        "Cycle 1",
        "5",
        export_board["user"]["username"],
        stored.created_at.strftime("%Y-%m-%d %H:%M:%S"),
        stored.updated_at.strftime("%Y-%m-%d %H:%M:%S"),
        export_board["parent"]["identifier"],
    ]


def test_an_issue_with_nothing_set_leaves_those_cells_empty(client, export_board):
    """The other half of the mapping: absent is an empty cell, not "None"."""
    parent = export_board["parent"]
    rows = export_rows(client, export_board)
    row = next(r for r in rows[1:] if r[0] == parent["identifier"])

    # assignee, labels, project, cycle, estimate, parent_key.
    assert [row[5], row[6], row[7], row[8], row[9], row[13]] == ["", "", "", "", "", ""]
    assert row[1] == "Parent issue"
    assert row[4] == "no_priority"


def test_export_cells_that_look_like_formulas_are_neutralised(client, export_board):
    """Typed text a spreadsheet would run as a formula comes out as text."""
    team_id = export_board["team_id"]
    headers = export_board["headers"]
    label = client.post(
        f"/teams/{team_id}/labels", json={"name": "@label"}, headers=headers
    ).json()
    issue = client.post(
        f"/teams/{team_id}/issues",
        json={
            "title": '=HYPERLINK("https://evil.example","x")',
            "description": "+1+1",
            "label_ids": [label["id"]],
        },
        headers=headers,
    ).json()

    rows = export_rows(client, export_board)
    row = next(r for r in rows[1:] if r[0] == issue["identifier"])

    assert row[1] == '\'=HYPERLINK("https://evil.example","x")'
    assert row[2] == "'+1+1"
    assert row[6] == "'@label"


def test_export_timestamps_are_formatted_without_losing_the_stored_value(
    client, export_board, session
):
    """The CSV is reformatted; the row behind it keeps its full precision."""
    stored = session.get(Issue, export_board["child"]["id"])
    rows = export_rows(client, export_board)
    row = next(r for r in rows[1:] if r[0] == export_board["child"]["identifier"])

    assert row[11] == stored.created_at.strftime("%Y-%m-%d %H:%M:%S")
    assert row[12] == stored.updated_at.strftime("%Y-%m-%d %H:%M:%S")
    assert "T" not in row[11] and "." not in row[11]
    # The stored timestamp still carries the microseconds the CSV drops.
    assert stored.created_at.isoformat() != row[11]


def test_the_export_streams_past_one_batch(client, export_board, monkeypatch):
    """Every matching issue comes out exactly once, over several batches.

    The batch size is turned down rather than the issue count up: what is
    worth testing is the cursor between batches, and a boundary bug drops or
    repeats a row whether the batch holds two issues or five hundred.
    """
    monkeypatch.setattr(issues_service, "EXPORT_BATCH_SIZE", 2)
    for n in range(5):
        client.post(
            f"/teams/{export_board['team_id']}/issues",
            json={"title": f"filler {n}"},
            headers=export_board["headers"],
        )

    keys = [row[0] for row in export_rows(client, export_board)[1:]]

    assert keys == [f"ENG-{n}" for n in range(7, 0, -1)]


#: Tables the export must never read on the request's own session. Whether
#: FastAPI closes a `yield` dependency before or after a streaming body has
#: moved between versions, so the export does not depend on the answer: it
#: checks who is asking on the request's session and then reads every row on
#: one it opens and closes itself.
_REQUEST_SESSION_MUST_NOT_READ = ("issue", "project", "cycle", "label")


def test_the_rows_are_read_on_the_export_s_own_session(client, export_board, session):
    """The request's session authorises the export and nothing more.

    The `client` fixture hands out a single session that is never closed,
    which would hide a generator still using the request's one, so this puts
    a real per-request session back and watches what it is asked for.
    """
    statements = []
    fetched = []

    class Tripwire(Session):
        def exec(self, statement, *args, **kwargs):
            statements.append(str(statement).lower())
            return super().exec(statement, *args, **kwargs)

        def get(self, entity, *args, **kwargs):
            fetched.append(entity.__name__.lower())
            return super().get(entity, *args, **kwargs)

    def request_scoped_session():
        with Tripwire(session.get_bind()) as scoped:
            yield scoped

    app.dependency_overrides[get_session] = request_scoped_session
    try:
        rows = export_rows(client, export_board)
    finally:
        app.dependency_overrides[get_session] = lambda: session

    assert statements, "the tripwire session was never used, so this proves nothing"
    for table in _REQUEST_SESSION_MUST_NOT_READ:
        assert table not in fetched
        assert not any(f" {table} " in text for text in statements), table

    # And the export still came out whole, off the session it opened itself.
    assert [row[0] for row in rows[1:]] == ["ENG-2", "ENG-1"]


def test_non_member_cannot_export(client, issue, auth):
    outsider = auth(email="outsider2@softtrack.dev")
    response = client.get(
        f"/teams/{issue['team_id']}/issues/export", headers=outsider["headers"]
    )
    assert response.status_code == 403

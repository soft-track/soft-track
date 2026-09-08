"""Filtering the issue list, including the two filters saved views added (#21).

Every one of these runs on the server. The board used to narrow the page it
already held, which quietly meant "urgent issues among the fifty most recent"
-- so the property worth guarding is that a filter sees the whole table, and
`total` says so.
"""

import pytest


@pytest.fixture
def board(client, team, auth):
    """A team with two people, two labels, and issues spread across both."""
    member = auth(email="member@softtrack.dev", full_name="Plain Member")
    client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": "member@softtrack.dev"},
        headers=team["headers"],
    )
    team_id = team["team"]["id"]

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

    issue("bug for me", label_ids=[bug["id"]], assignee_id=team["user"]["id"])
    issue("bug for them", label_ids=[bug["id"]], assignee_id=member["user"]["id"])
    issue("chore, nobody", label_ids=[chore["id"]])
    issue("nothing at all")

    return {**team, "member": member, "team_id": team_id, "bug": bug, "chore": chore}


def titles(client, board, query=""):
    response = client.get(
        f"/teams/{board['team_id']}/issues?{query}", headers=board["headers"]
    )
    assert response.status_code == 200, response.text
    body = response.json()
    # `total` counts matches, not the page -- the two must agree here.
    assert body["total"] == len(body["items"])
    return sorted(item["title"] for item in body["items"])


def test_filtering_by_label(client, board):
    assert titles(client, board, f"label_id={board['bug']['id']}") == [
        "bug for me",
        "bug for them",
    ]


def test_filtering_by_label_counts_an_issue_once(client, board):
    """An issue joined to its label links would come back once per link, and
    `total` would count it that many times."""
    second = client.post(
        f"/teams/{board['team_id']}/labels",
        json={"name": "Urgent"},
        headers=board["headers"],
    ).json()
    both = client.post(
        f"/teams/{board['team_id']}/issues",
        json={"title": "two labels", "label_ids": [board["bug"]["id"], second["id"]]},
        headers=board["headers"],
    ).json()

    body = client.get(
        f"/teams/{board['team_id']}/issues?label_id={board['bug']['id']}",
        headers=board["headers"],
    ).json()
    assert body["total"] == 3
    assert [item["id"] for item in body["items"]].count(both["id"]) == 1


def test_filtering_by_unassigned(client, board):
    assert titles(client, board, "unassigned=true") == [
        "chore, nobody",
        "nothing at all",
    ]


def test_unassigned_overrides_an_assignee_id(client, board):
    """The two are contradictory; the route documents unassigned as winning,
    so a client that sends both gets a defined answer rather than nothing."""
    query = f"unassigned=true&assignee_id={board['user']['id']}"
    assert titles(client, board, query) == ["chore, nobody", "nothing at all"]


def test_an_assignee_filter_without_unassigned_is_unaffected(client, board):
    assert titles(client, board, f"assignee_id={board['user']['id']}") == ["bug for me"]


def test_filters_compose(client, board):
    query = f"label_id={board['bug']['id']}&assignee_id={board['member']['user']['id']}"
    assert titles(client, board, query) == ["bug for them"]


def test_a_filter_sees_past_the_first_page(client, board):
    """The reason filtering moved to the server.

    Sixty unmatching issues are created after the one that matches, so it is
    off the first page by number order. A client-side filter over that page
    would find nothing.
    """
    match = client.post(
        f"/teams/{board['team_id']}/issues",
        json={"title": "the needle", "priority": "urgent"},
        headers=board["headers"],
    ).json()
    for n in range(60):
        client.post(
            f"/teams/{board['team_id']}/issues",
            json={"title": f"filler {n}"},
            headers=board["headers"],
        )

    body = client.get(
        f"/teams/{board['team_id']}/issues?priority=urgent",
        headers=board["headers"],
    ).json()
    assert body["total"] == 1
    assert [item["id"] for item in body["items"]] == [match["id"]]

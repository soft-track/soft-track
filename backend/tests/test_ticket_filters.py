"""Filtering the ticket list, including the two filters saved views added (#21).

Every one of these runs on the server. The board used to narrow the page it
already held, which quietly meant "urgent tickets among the fifty most recent"
-- so the property worth guarding is that a filter sees the whole table, and
`total` says so.
"""

import csv
import io

import pytest


@pytest.fixture
def board(client, team, auth):
    """A team with two people, two labels, and tickets spread across both."""
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

    def ticket(title, **fields):
        response = client.post(
            f"/teams/{team_id}/tickets",
            json={"title": title, **fields},
            headers=team["headers"],
        )
        assert response.status_code == 200, response.text
        return response.json()

    ticket("bug for me", label_ids=[bug["id"]], assignee_id=team["user"]["id"])
    ticket("bug for them", label_ids=[bug["id"]], assignee_id=member["user"]["id"])
    ticket("chore, nobody", label_ids=[chore["id"]])
    ticket("nothing at all")

    return {**team, "member": member, "team_id": team_id, "bug": bug, "chore": chore}


def titles(client, board, query=""):
    response = client.get(
        f"/teams/{board['team_id']}/tickets?{query}", headers=board["headers"]
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


def test_filtering_by_label_counts_a_ticket_once(client, board):
    """A ticket joined to its label links would come back once per link, and
    `total` would count it that many times."""
    second = client.post(
        f"/teams/{board['team_id']}/labels",
        json={"name": "Urgent"},
        headers=board["headers"],
    ).json()
    both = client.post(
        f"/teams/{board['team_id']}/tickets",
        json={"title": "two labels", "label_ids": [board["bug"]["id"], second["id"]]},
        headers=board["headers"],
    ).json()

    body = client.get(
        f"/teams/{board['team_id']}/tickets?label_id={board['bug']['id']}",
        headers=board["headers"],
    ).json()
    assert body["total"] == 3
    assert [item["id"] for item in body["items"]].count(both["id"]) == 1


def test_filtering_by_unassigned(client, board):
    assert titles(client, board, "unassigned=true") == [
        "chore, nobody",
        "nothing at all",
    ]


def test_unassigned_beside_an_assignee_means_either(client, board):
    """Unassigned is one of the assignee choices (#260): "me, or nobody".
    It used to override the assignee instead."""
    query = f"unassigned=true&assignee_id={board['user']['id']}"
    assert titles(client, board, query) == [
        "bug for me",
        "chore, nobody",
        "nothing at all",
    ]


def test_an_assignee_filter_without_unassigned_is_unaffected(client, board):
    assert titles(client, board, f"assignee_id={board['user']['id']}") == ["bug for me"]


def test_filters_compose(client, board):
    query = f"label_id={board['bug']['id']}&assignee_id={board['member']['user']['id']}"
    assert titles(client, board, query) == ["bug for them"]


def test_a_filter_sees_past_the_first_page(client, board):
    """The reason filtering moved to the server.

    Sixty unmatching tickets are created after the one that matches, so it is
    off the first page by number order. A client-side filter over that page
    would find nothing.
    """
    match = client.post(
        f"/teams/{board['team_id']}/tickets",
        json={"title": "the needle", "priority": "urgent"},
        headers=board["headers"],
    ).json()
    for n in range(60):
        client.post(
            f"/teams/{board['team_id']}/tickets",
            json={"title": f"filler {n}"},
            headers=board["headers"],
        )

    body = client.get(
        f"/teams/{board['team_id']}/tickets?priority=urgent",
        headers=board["headers"],
    ).json()
    assert body["total"] == 1
    assert [item["id"] for item in body["items"]] == [match["id"]]


def test_export_respects_filters_and_is_unpaginated(client, board):
    """The reason the export has no `limit`.

    The one match is pushed off the first page by sixty tickets filed after
    it, so an export that paginated like the list would hand back a
    spreadsheet that does not contain the thing it was filtered for.
    """
    match = client.post(
        f"/teams/{board['team_id']}/tickets",
        json={"title": "needle for export", "priority": "urgent"},
        headers=board["headers"],
    ).json()
    for n in range(60):
        client.post(
            f"/teams/{board['team_id']}/tickets",
            json={"title": f"filler {n}"},
            headers=board["headers"],
        )

    response = client.get(
        f"/teams/{board['team_id']}/tickets/export?priority=urgent",
        headers=board["headers"],
    )
    assert response.status_code == 200
    rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))

    # The header and the one match, and nothing else.
    assert len(rows) == 2
    assert rows[1][0] == match["identifier"]
    assert rows[1][1] == "needle for export"


def test_export_counts_a_labelled_ticket_once(client, board):
    """The label filter is a subquery for the same reason the list's is: a
    join would repeat the row once per matching link."""
    second = client.post(
        f"/teams/{board['team_id']}/labels",
        json={"name": "Urgent"},
        headers=board["headers"],
    ).json()
    both = client.post(
        f"/teams/{board['team_id']}/tickets",
        json={"title": "two labels", "label_ids": [board["bug"]["id"], second["id"]]},
        headers=board["headers"],
    ).json()

    response = client.get(
        f"/teams/{board['team_id']}/tickets/export?label_id={board['bug']['id']}",
        headers=board["headers"],
    )
    rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
    keys = [row[0] for row in rows[1:]]

    assert keys.count(both["identifier"]) == 1
    assert sorted(keys) == sorted([both["identifier"], "ENG-1", "ENG-2"])


# --- several values at once (#260) ---------------------------------------


@pytest.fixture
def more(client, board):
    """The board, plus a Design label, a story, a done ticket and priorities."""
    team_id, headers = board["team_id"], board["headers"]
    design = client.post(
        f"/teams/{team_id}/labels", json={"name": "Design"}, headers=headers
    ).json()

    def ticket(title, **fields):
        response = client.post(
            f"/teams/{team_id}/tickets",
            json={"title": title, **fields},
            headers=headers,
        )
        assert response.status_code == 200, response.text
        return response.json()

    ticket("design bug", label_ids=[board["bug"]["id"], design["id"]], type="bug")
    ticket("a story", type="story", priority="high")
    ticket("urgent and done", priority="urgent", status_id=board["status_ids"]["Done"])
    return {**board, "design": design}


def test_several_values_in_one_filter_are_alternatives(client, board):
    query = (
        f"assignee_id={board['user']['id']}&assignee_id={board['member']['user']['id']}"
    )
    assert titles(client, board, query) == ["bug for me", "bug for them"]


def test_one_value_reads_as_a_list_of_one(client, board):
    """Every link and client from before lists keeps asking what it asked."""
    assert titles(client, board, f"assignee_id={board['user']['id']}") == ["bug for me"]


def test_different_filters_narrow_each_other(client, more):
    query = (
        f"label_id={more['bug']['id']}&label_id={more['chore']['id']}"
        "&type=bug&type=story"
    )
    # Bug or Chore, and a bug or a story: the plain tasks drop out.
    assert titles(client, more, query) == ["design bug"]


def test_excluding_an_assignee_keeps_the_unassigned(client, board):
    """Everyone except me includes the tickets nobody holds, which SQL's
    NOT IN would quietly drop."""
    query = f"assignee_id={board['user']['id']}&assignee_exclude=true"
    assert titles(client, board, query) == [
        "bug for them",
        "chore, nobody",
        "nothing at all",
    ]


def test_excluding_unassigned_leaves_the_assigned(client, board):
    assert titles(client, board, "unassigned=true&assignee_exclude=true") == [
        "bug for me",
        "bug for them",
    ]


def test_not_done(client, more):
    query = f"status_id={more['status_ids']['Done']}&status_exclude=true"
    assert "urgent and done" not in titles(client, more, query)
    assert len(titles(client, more, query)) == 6


def test_a_switch_with_nothing_chosen_is_no_filter(client, more):
    assert len(titles(client, more, "status_exclude=true&label_exclude=true")) == 7


def test_labels_any_or_all(client, more):
    pair = f"label_id={more['bug']['id']}&label_id={more['design']['id']}"
    # Any of them finds both piles; all of them finds the design bugs.
    assert titles(client, more, pair) == ["bug for me", "bug for them", "design bug"]
    assert titles(client, more, f"{pair}&label_match=all") == ["design bug"]


def test_excluding_labels(client, more):
    query = f"label_id={more['bug']['id']}&label_exclude=true"
    assert titles(client, more, query) == [
        "a story",
        "chore, nobody",
        "nothing at all",
        "urgent and done",
    ]
    # Without every one of them: only the design bug carries both.
    query = (
        f"label_id={more['bug']['id']}&label_id={more['design']['id']}"
        "&label_match=all&label_exclude=true"
    )
    assert "design bug" not in titles(client, more, query)
    assert "bug for me" in titles(client, more, query)


def test_several_priorities_and_excluding_types(client, more):
    assert titles(client, more, "priority=urgent&priority=high") == [
        "a story",
        "urgent and done",
    ]
    assert titles(client, more, "type=task&type_exclude=true") == [
        "a story",
        "design bug",
    ]


def test_export_follows_the_same_lists(client, more):
    """The CSV takes the list's filters through the same dependency -- type
    and due included, which it used to ignore."""
    query = (
        f"assignee_id={more['user']['id']}&unassigned=true"
        f"&status_id={more['status_ids']['Done']}&status_exclude=true&type=task"
    )
    response = client.get(
        f"/teams/{more['team_id']}/tickets/export?{query}", headers=more["headers"]
    )
    assert response.status_code == 200
    rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert sorted(row[1] for row in rows[1:]) == titles(client, more, query)
    assert sorted(row[1] for row in rows[1:]) == [
        "bug for me",
        "chore, nobody",
        "nothing at all",
    ]

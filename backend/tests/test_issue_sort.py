"""Sorting the issue list (issue #88, part 1)."""

import pytest


def make_issue(client, team, title, **fields):
    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": title, **fields},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def order(client, team, **params):
    response = client.get(
        f"/teams/{team['team']['id']}/issues", params=params, headers=team["headers"]
    )
    assert response.status_code == 200, response.text
    return [issue["title"] for issue in response.json()["items"]]


@pytest.fixture
def issues(client, team):
    """Filed in this order, so "created" ascending is A, b, C, D."""
    make_issue(client, team, "A", priority="low", estimate=3)
    make_issue(client, team, "b", priority="urgent")
    make_issue(client, team, "C", priority="urgent", estimate=8)
    make_issue(client, team, "D", priority="no_priority", estimate=1)


def test_the_default_is_newest_first_as_it_always_was(client, team, issues):
    assert order(client, team) == ["D", "C", "b", "A"]
    assert order(client, team, sort="created", direction="asc") == ["A", "b", "C", "D"]


def test_by_priority_most_urgent_first(client, team, issues):
    # C and b tie on urgent; the newer one comes first.
    assert order(client, team, sort="priority") == ["C", "b", "A", "D"]
    assert order(client, team, sort="priority", direction="asc") == ["D", "A", "C", "b"]


def test_by_estimate_unsized_last_whichever_way(client, team, issues):
    assert order(client, team, sort="estimate") == ["C", "A", "D", "b"]
    assert order(client, team, sort="estimate", direction="asc") == ["D", "A", "C", "b"]


def test_by_title_ignoring_case(client, team, issues):
    assert order(client, team, sort="title", direction="asc") == ["A", "b", "C", "D"]
    assert order(client, team, sort="title") == ["D", "C", "b", "A"]


def test_by_recently_updated(client, team, issues):
    first = order(client, team, sort="created", direction="asc")
    listed = client.get(
        f"/teams/{team['team']['id']}/issues",
        params={"sort": "created", "direction": "asc"},
        headers=team["headers"],
    ).json()["items"]
    oldest = listed[0]
    client.patch(
        f"/issues/{oldest['id']}", json={"title": "A, edited"}, headers=team["headers"]
    )
    assert order(client, team, sort="updated")[0] == "A, edited"
    assert first[0] == "A"


def test_sorting_composes_with_filters_and_paging(client, team, issues):
    page = order(client, team, sort="priority", priority="urgent", limit=1)
    assert page == ["C"]
    page = order(client, team, sort="priority", priority="urgent", limit=1, offset=1)
    assert page == ["b"]


def test_an_unknown_sort_is_refused(client, team):
    response = client.get(
        f"/teams/{team['team']['id']}/issues",
        params={"sort": "vibes"},
        headers=team["headers"],
    )
    assert response.status_code == 422


def test_a_saved_view_keeps_its_sort_and_can_go_back_to_the_default(client, team):
    team_id = team["team"]["id"]
    view = client.post(
        f"/teams/{team_id}/views",
        json={"name": "Hot", "sort": "priority", "sort_direction": "desc"},
        headers=team["headers"],
    ).json()
    assert (view["sort"], view["sort_direction"]) == ("priority", "desc")

    renamed = client.patch(
        f"/views/{view['id']}", json={"name": "Hotter"}, headers=team["headers"]
    ).json()
    assert renamed["sort"] == "priority", "a rename must not reset the sort"

    reset = client.patch(
        f"/views/{view['id']}",
        json={"sort": None, "sort_direction": None},
        headers=team["headers"],
    ).json()
    assert (reset["sort"], reset["sort_direction"]) == (None, None)

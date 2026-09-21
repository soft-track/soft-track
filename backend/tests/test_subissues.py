"""Parent/child issues, one level deep (issue #13)."""

import pytest


def make_issue(client, team, title="Work", **fields):
    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": title, **fields},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def get_issue(client, team, issue):
    return client.get(f"/issues/{issue['id']}", headers=team["headers"]).json()


def set_parent(client, team, child, parent_id):
    return client.patch(
        f"/issues/{child['id']}", json={"parent_id": parent_id}, headers=team["headers"]
    )


# --- the happy path ----------------------------------------------------


def test_a_child_can_be_created_under_a_parent(client, team):
    parent = make_issue(client, team, "Ship the release")
    child = make_issue(client, team, "Write the migration", parent_id=parent["id"])

    assert child["parent"]["id"] == parent["id"]
    assert child["parent"]["title"] == "Ship the release"
    assert child["parent"]["identifier"].startswith("ENG-")
    assert child["parent"]["team_key"] == "ENG"
    assert child["parent"]["number"] == parent["number"]


def test_an_existing_issue_can_be_nested_later(client, team):
    parent, child = make_issue(client, team, "P"), make_issue(client, team, "C")
    assert set_parent(client, team, child, parent["id"]).status_code == 200
    assert get_issue(client, team, child)["parent"]["id"] == parent["id"]


def test_a_child_can_be_detached(client, team):
    parent = make_issue(client, team, "P")
    child = make_issue(client, team, "C", parent_id=parent["id"])

    assert set_parent(client, team, child, None).status_code == 200
    assert get_issue(client, team, child)["parent"] is None
    assert get_issue(client, team, parent)["child_count"] == 0


def test_children_are_listed_by_filtering_on_the_parent(client, team):
    parent = make_issue(client, team, "P")
    make_issue(client, team, "C1", parent_id=parent["id"])
    make_issue(client, team, "C2", parent_id=parent["id"])
    make_issue(client, team, "Unrelated")

    page = client.get(
        f"/teams/{team['team']['id']}/issues",
        params={"parent_id": parent["id"]},
        headers=team["headers"],
    ).json()
    assert sorted(item["title"] for item in page["items"]) == ["C1", "C2"]


# --- the one-level rule ------------------------------------------------


def test_an_issue_cannot_be_its_own_parent(client, team):
    issue = make_issue(client, team, "P")
    response = set_parent(client, team, issue, issue["id"])
    assert response.status_code == 400
    assert "its own parent" in response.json()["detail"]


def test_a_sub_issue_cannot_itself_be_a_parent(client, team):
    """The rule that makes cycles impossible without a graph walk."""
    grandparent = make_issue(client, team, "GP")
    parent = make_issue(client, team, "P", parent_id=grandparent["id"])
    child = make_issue(client, team, "C")

    response = set_parent(client, team, child, parent["id"])
    assert response.status_code == 400
    assert "one level" in response.json()["detail"]


def test_a_parent_cannot_become_a_sub_issue(client, team):
    """The other half of the pair. Without it, A->B->C could be built by
    nesting from the top down instead of the bottom up."""
    parent = make_issue(client, team, "P")
    make_issue(client, team, "C", parent_id=parent["id"])
    other = make_issue(client, team, "Other")

    response = set_parent(client, team, parent, other["id"])
    assert response.status_code == 400
    assert "sub-issues of its own" in response.json()["detail"]


def test_a_two_issue_cycle_is_impossible(client, team):
    a, b = make_issue(client, team, "A"), make_issue(client, team, "B")
    assert set_parent(client, team, a, b["id"]).status_code == 200
    # B would now need both a parent and a child.
    assert set_parent(client, team, b, a["id"]).status_code == 400


def test_a_parent_must_be_on_the_same_team(client, team):
    child = make_issue(client, team, "C")
    second = client.post(
        "/teams", json={"name": "Second", "key": "SEC"}, headers=team["headers"]
    ).json()
    elsewhere = client.post(
        f"/teams/{second['id']}/issues", json={"title": "E"}, headers=team["headers"]
    ).json()

    response = set_parent(client, team, child, elsewhere["id"])
    assert response.status_code == 400
    assert "same team" in response.json()["detail"]


def test_a_missing_parent_is_a_404(client, team):
    child = make_issue(client, team, "C")
    assert set_parent(client, team, child, 99999).status_code == 404


def test_a_rejected_parent_leaves_the_issue_untouched(client, team):
    """Validation runs before anything is assigned, so a 400 is not a
    half-applied update."""
    child = make_issue(client, team, "C", priority="urgent")
    client.patch(
        f"/issues/{child['id']}",
        json={"parent_id": child["id"], "title": "Renamed"},
        headers=team["headers"],
    )

    after = get_issue(client, team, child)
    assert after["title"] == "C"
    assert after["parent"] is None


# --- progress ----------------------------------------------------------


def test_a_parent_counts_its_children(client, team):
    parent = make_issue(client, team, "P")
    make_issue(
        client, team, "C1", parent_id=parent["id"], status_id=team["status_ids"]["Done"]
    )
    make_issue(client, team, "C2", parent_id=parent["id"])
    make_issue(client, team, "C3", parent_id=parent["id"])

    fetched = get_issue(client, team, parent)
    assert (fetched["completed_child_count"], fetched["child_count"]) == (1, 3)


def test_a_cancelled_child_is_left_out_of_both_numbers(client, team):
    """Otherwise "3 of 5 done" becomes unreachable because two were cancelled."""
    parent = make_issue(client, team, "P")
    make_issue(
        client, team, "C1", parent_id=parent["id"], status_id=team["status_ids"]["Done"]
    )
    make_issue(
        client,
        team,
        "C2",
        parent_id=parent["id"],
        status_id=team["status_ids"]["Cancelled"],
    )

    fetched = get_issue(client, team, parent)
    assert (fetched["completed_child_count"], fetched["child_count"]) == (1, 1)


def test_an_issue_with_no_children_reports_zero(client, team):
    issue = get_issue(client, team, make_issue(client, team, "Solo"))
    assert (issue["completed_child_count"], issue["child_count"]) == (0, 0)


def test_the_list_endpoint_reports_the_same_counts(client, team):
    """The list builds IssueRead by a different path than the detail route."""
    parent = make_issue(client, team, "P")
    make_issue(
        client, team, "C", parent_id=parent["id"], status_id=team["status_ids"]["Done"]
    )

    items = client.get(
        f"/teams/{team['team']['id']}/issues", headers=team["headers"]
    ).json()["items"]
    by_title = {item["title"]: item for item in items}

    assert by_title["C"]["team_key"] == "ENG"
    assert by_title["P"]["child_count"] == 1
    assert by_title["P"]["completed_child_count"] == 1
    assert by_title["C"]["parent"]["id"] == parent["id"]


# --- deleting a parent -------------------------------------------------


def test_deleting_a_parent_promotes_its_children(client, team):
    """Losing a parent must not lose the work underneath it."""
    parent = make_issue(client, team, "P")
    child = make_issue(client, team, "C", parent_id=parent["id"])

    assert (
        client.delete(f"/issues/{parent['id']}", headers=team["headers"]).status_code
        == 204
    )

    survivor = client.get(f"/issues/{child['id']}", headers=team["headers"])
    assert survivor.status_code == 200
    assert survivor.json()["parent"] is None
    assert survivor.json()["title"] == "C"


def test_deleting_a_child_leaves_the_parent_and_its_count_correct(client, team):
    parent = make_issue(client, team, "P")
    keep = make_issue(client, team, "Keep", parent_id=parent["id"])
    drop = make_issue(client, team, "Drop", parent_id=parent["id"])

    client.delete(f"/issues/{drop['id']}", headers=team["headers"])

    fetched = get_issue(client, team, parent)
    assert fetched["child_count"] == 1
    assert get_issue(client, team, keep)["parent"]["id"] == parent["id"]


@pytest.mark.parametrize("status", ["Done", "Cancelled"])
def test_child_status_changes_move_the_count(client, team, status):
    parent = make_issue(client, team, "P")
    child = make_issue(client, team, "C", parent_id=parent["id"])
    assert get_issue(client, team, parent)["child_count"] == 1

    client.patch(
        f"/issues/{child['id']}",
        json={"status_id": team["status_ids"][status]},
        headers=team["headers"],
    )
    fetched = get_issue(client, team, parent)
    expected = (1, 1) if status == "Done" else (0, 0)
    assert (fetched["completed_child_count"], fetched["child_count"]) == expected

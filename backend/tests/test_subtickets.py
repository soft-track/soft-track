"""Parent/child tickets, one level deep (issue #13)."""

import pytest


def make_ticket(client, team, title="Work", **fields):
    response = client.post(
        f"/teams/{team['team']['id']}/tickets",
        json={"title": title, **fields},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def get_ticket(client, team, ticket):
    return client.get(f"/tickets/{ticket['id']}", headers=team["headers"]).json()


def set_parent(client, team, child, parent_id):
    return client.patch(
        f"/tickets/{child['id']}",
        json={"parent_id": parent_id},
        headers=team["headers"],
    )


# --- the happy path ----------------------------------------------------


def test_a_child_can_be_created_under_a_parent(client, team):
    parent = make_ticket(client, team, "Ship the release")
    child = make_ticket(client, team, "Write the migration", parent_id=parent["id"])

    assert child["parent"]["id"] == parent["id"]
    assert child["parent"]["title"] == "Ship the release"
    assert child["parent"]["identifier"].startswith("ENG-")
    assert child["parent"]["team_key"] == "ENG"
    assert child["parent"]["number"] == parent["number"]


def test_an_existing_ticket_can_be_nested_later(client, team):
    parent, child = make_ticket(client, team, "P"), make_ticket(client, team, "C")
    assert set_parent(client, team, child, parent["id"]).status_code == 200
    assert get_ticket(client, team, child)["parent"]["id"] == parent["id"]


def test_a_child_can_be_detached(client, team):
    parent = make_ticket(client, team, "P")
    child = make_ticket(client, team, "C", parent_id=parent["id"])

    assert set_parent(client, team, child, None).status_code == 200
    assert get_ticket(client, team, child)["parent"] is None
    assert get_ticket(client, team, parent)["child_count"] == 0


def test_children_are_listed_by_filtering_on_the_parent(client, team):
    parent = make_ticket(client, team, "P")
    make_ticket(client, team, "C1", parent_id=parent["id"])
    make_ticket(client, team, "C2", parent_id=parent["id"])
    make_ticket(client, team, "Unrelated")

    page = client.get(
        f"/teams/{team['team']['id']}/tickets",
        params={"parent_id": parent["id"]},
        headers=team["headers"],
    ).json()
    assert sorted(item["title"] for item in page["items"]) == ["C1", "C2"]


# --- the one-level rule ------------------------------------------------


def test_a_ticket_cannot_be_its_own_parent(client, team):
    ticket = make_ticket(client, team, "P")
    response = set_parent(client, team, ticket, ticket["id"])
    assert response.status_code == 400
    assert "its own parent" in response.json()["detail"]


def test_a_sub_ticket_cannot_itself_be_a_parent(client, team):
    """The rule that makes cycles impossible without a graph walk."""
    grandparent = make_ticket(client, team, "GP")
    parent = make_ticket(client, team, "P", parent_id=grandparent["id"])
    child = make_ticket(client, team, "C")

    response = set_parent(client, team, child, parent["id"])
    assert response.status_code == 400
    assert "one level" in response.json()["detail"]


def test_a_parent_cannot_become_a_sub_ticket(client, team):
    """The other half of the pair. Without it, A->B->C could be built by
    nesting from the top down instead of the bottom up."""
    parent = make_ticket(client, team, "P")
    make_ticket(client, team, "C", parent_id=parent["id"])
    other = make_ticket(client, team, "Other")

    response = set_parent(client, team, parent, other["id"])
    assert response.status_code == 400
    assert "sub-tickets of its own" in response.json()["detail"]


def test_a_two_ticket_cycle_is_impossible(client, team):
    a, b = make_ticket(client, team, "A"), make_ticket(client, team, "B")
    assert set_parent(client, team, a, b["id"]).status_code == 200
    # B would now need both a parent and a child.
    assert set_parent(client, team, b, a["id"]).status_code == 400


def test_a_parent_must_be_on_the_same_team(client, team):
    child = make_ticket(client, team, "C")
    second = client.post(
        "/teams", json={"name": "Second", "key": "SEC"}, headers=team["headers"]
    ).json()
    elsewhere = client.post(
        f"/teams/{second['id']}/tickets", json={"title": "E"}, headers=team["headers"]
    ).json()

    response = set_parent(client, team, child, elsewhere["id"])
    assert response.status_code == 400
    assert "same team" in response.json()["detail"]


def test_a_missing_parent_is_a_404(client, team):
    child = make_ticket(client, team, "C")
    assert set_parent(client, team, child, 99999).status_code == 404


def test_a_rejected_parent_leaves_the_ticket_untouched(client, team):
    """Validation runs before anything is assigned, so a 400 is not a
    half-applied update."""
    child = make_ticket(client, team, "C", priority="urgent")
    client.patch(
        f"/tickets/{child['id']}",
        json={"parent_id": child["id"], "title": "Renamed"},
        headers=team["headers"],
    )

    after = get_ticket(client, team, child)
    assert after["title"] == "C"
    assert after["parent"] is None


# --- progress ----------------------------------------------------------


def test_a_parent_counts_its_children(client, team):
    parent = make_ticket(client, team, "P")
    make_ticket(
        client, team, "C1", parent_id=parent["id"], status_id=team["status_ids"]["Done"]
    )
    make_ticket(client, team, "C2", parent_id=parent["id"])
    make_ticket(client, team, "C3", parent_id=parent["id"])

    fetched = get_ticket(client, team, parent)
    assert (fetched["completed_child_count"], fetched["child_count"]) == (1, 3)


def test_a_cancelled_child_is_left_out_of_both_numbers(client, team):
    """Otherwise "3 of 5 done" becomes unreachable because two were cancelled."""
    parent = make_ticket(client, team, "P")
    make_ticket(
        client, team, "C1", parent_id=parent["id"], status_id=team["status_ids"]["Done"]
    )
    make_ticket(
        client,
        team,
        "C2",
        parent_id=parent["id"],
        status_id=team["status_ids"]["Cancelled"],
    )

    fetched = get_ticket(client, team, parent)
    assert (fetched["completed_child_count"], fetched["child_count"]) == (1, 1)


def test_a_ticket_with_no_children_reports_zero(client, team):
    ticket = get_ticket(client, team, make_ticket(client, team, "Solo"))
    assert (ticket["completed_child_count"], ticket["child_count"]) == (0, 0)


def test_the_list_endpoint_reports_the_same_counts(client, team):
    """The list builds TicketRead by a different path than the detail route."""
    parent = make_ticket(client, team, "P")
    make_ticket(
        client, team, "C", parent_id=parent["id"], status_id=team["status_ids"]["Done"]
    )

    items = client.get(
        f"/teams/{team['team']['id']}/tickets", headers=team["headers"]
    ).json()["items"]
    by_title = {item["title"]: item for item in items}

    assert by_title["C"]["team_key"] == "ENG"
    assert by_title["P"]["child_count"] == 1
    assert by_title["P"]["completed_child_count"] == 1
    assert by_title["C"]["parent"]["id"] == parent["id"]


# --- deleting a parent -------------------------------------------------


def test_deleting_a_parent_promotes_its_children(client, team):
    """Losing a parent must not lose the work underneath it."""
    parent = make_ticket(client, team, "P")
    child = make_ticket(client, team, "C", parent_id=parent["id"])

    assert (
        client.delete(f"/tickets/{parent['id']}", headers=team["headers"]).status_code
        == 204
    )

    survivor = client.get(f"/tickets/{child['id']}", headers=team["headers"])
    assert survivor.status_code == 200
    assert survivor.json()["parent"] is None
    assert survivor.json()["title"] == "C"


def test_deleting_a_child_leaves_the_parent_and_its_count_correct(client, team):
    parent = make_ticket(client, team, "P")
    keep = make_ticket(client, team, "Keep", parent_id=parent["id"])
    drop = make_ticket(client, team, "Drop", parent_id=parent["id"])

    client.delete(f"/tickets/{drop['id']}", headers=team["headers"])

    fetched = get_ticket(client, team, parent)
    assert fetched["child_count"] == 1
    assert get_ticket(client, team, keep)["parent"]["id"] == parent["id"]


@pytest.mark.parametrize("status", ["Done", "Cancelled"])
def test_child_status_changes_move_the_count(client, team, status):
    parent = make_ticket(client, team, "P")
    child = make_ticket(client, team, "C", parent_id=parent["id"])
    assert get_ticket(client, team, parent)["child_count"] == 1

    client.patch(
        f"/tickets/{child['id']}",
        json={"status_id": team["status_ids"][status]},
        headers=team["headers"],
    )
    fetched = get_ticket(client, team, parent)
    expected = (1, 1) if status == "Done" else (0, 0)
    assert (fetched["completed_child_count"], fetched["child_count"]) == expected

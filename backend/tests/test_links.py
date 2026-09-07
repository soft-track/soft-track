"""Issue relationships (issue #14).

The invariant under most of these: a relationship is *one* row, read from both
ends. Anything that could let the two issues disagree about their relationship
is the bug this file is guarding against.
"""

import pytest


def make_issue(client, team, title="Some work", **fields):
    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": title, **fields},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def link(client, team, source, target, type_="blocks"):
    return client.post(
        f"/issues/{source['id']}/links",
        json={"target_id": target["id"], "type": type_},
        headers=team["headers"],
    )


def links_of(client, team, issue):
    response = client.get(f"/issues/{issue['id']}/links", headers=team["headers"])
    assert response.status_code == 200, response.text
    return response.json()


# --- both ends see the same relationship -------------------------------


def test_a_blocks_link_reads_as_blocked_by_from_the_other_end(client, team):
    a, b = make_issue(client, team, "A"), make_issue(client, team, "B")
    assert link(client, team, a, b).status_code == 200

    assert [row["issue"]["id"] for row in links_of(client, team, a)["blocks"]] == [
        b["id"]
    ]
    assert [row["issue"]["id"] for row in links_of(client, team, b)["blocked_by"]] == [
        a["id"]
    ]
    # And nothing leaks into the other direction's bucket.
    assert links_of(client, team, a)["blocked_by"] == []
    assert links_of(client, team, b)["blocks"] == []


def test_a_duplicates_link_reads_as_duplicated_by_from_the_other_end(client, team):
    a, b = make_issue(client, team, "A"), make_issue(client, team, "B")
    link(client, team, a, b, "duplicates")

    assert len(links_of(client, team, a)["duplicates"]) == 1
    assert len(links_of(client, team, b)["duplicated_by"]) == 1


def test_relates_to_reads_the_same_from_both_ends(client, team):
    """It is symmetric, so neither issue is the subject of the relationship."""
    a, b = make_issue(client, team, "A"), make_issue(client, team, "B")
    link(client, team, a, b, "relates_to")

    assert [row["issue"]["id"] for row in links_of(client, team, a)["relates_to"]] == [
        b["id"]
    ]
    assert [row["issue"]["id"] for row in links_of(client, team, b)["relates_to"]] == [
        a["id"]
    ]


def test_the_linked_issue_carries_enough_to_render_a_row(client, team):
    a = make_issue(client, team, "A")
    b = make_issue(client, team, "B", priority="urgent", status="in_progress")
    link(client, team, a, b)

    linked = links_of(client, team, a)["blocks"][0]["issue"]
    assert linked["identifier"].startswith("ENG-")
    assert linked["title"] == "B"
    assert linked["status"] == "in_progress"
    assert linked["priority"] == "urgent"


# --- what is refused ---------------------------------------------------


def test_an_issue_cannot_block_itself(client, team):
    a = make_issue(client, team, "A")
    response = link(client, team, a, a)
    assert response.status_code == 400
    assert "itself" in response.json()["detail"]


def test_the_same_link_cannot_be_added_twice(client, team):
    a, b = make_issue(client, team, "A"), make_issue(client, team, "B")
    assert link(client, team, a, b).status_code == 200
    assert link(client, team, a, b).status_code == 409


def test_two_issues_cannot_block_each_other(client, team):
    """That describes work that can never start, so it is refused."""
    a, b = make_issue(client, team, "A"), make_issue(client, team, "B")
    link(client, team, a, b)

    response = link(client, team, b, a)
    assert response.status_code == 409
    assert "blocked by" in response.json()["detail"]


def test_the_mirror_of_a_relates_link_is_not_a_second_relationship(client, team):
    a, b = make_issue(client, team, "A"), make_issue(client, team, "B")
    link(client, team, a, b, "relates_to")

    assert link(client, team, b, a, "relates_to").status_code == 409
    assert len(links_of(client, team, a)["relates_to"]) == 1


def test_blocking_and_relating_the_same_pair_is_allowed(client, team):
    """Different types are different facts; only the same type collides."""
    a, b = make_issue(client, team, "A"), make_issue(client, team, "B")
    assert link(client, team, a, b, "blocks").status_code == 200
    assert link(client, team, a, b, "relates_to").status_code == 200


def test_linking_to_an_issue_you_cannot_see_is_refused(client, team, auth):
    """Otherwise the link endpoint becomes a way to probe other teams."""
    mine = make_issue(client, team, "Mine")

    outsider = auth(email="outsider@softtrack.dev", full_name="Outsider")
    other_team = client.post(
        "/teams", json={"name": "Other", "key": "OTH"}, headers=outsider["headers"]
    ).json()
    theirs = client.post(
        f"/teams/{other_team['id']}/issues",
        json={"title": "Theirs"},
        headers=outsider["headers"],
    ).json()

    response = client.post(
        f"/issues/{mine['id']}/links",
        json={"target_id": theirs["id"], "type": "blocks"},
        headers=team["headers"],
    )
    assert response.status_code in (403, 404)


def test_linking_to_a_missing_issue_is_a_404(client, team):
    a = make_issue(client, team, "A")
    response = client.post(
        f"/issues/{a['id']}/links",
        json={"target_id": 99999, "type": "blocks"},
        headers=team["headers"],
    )
    assert response.status_code == 404


# --- removing ----------------------------------------------------------


def test_either_end_can_remove_the_link(client, team):
    a, b = make_issue(client, team, "A"), make_issue(client, team, "B")
    link_id = link(client, team, a, b).json()["id"]

    # From the target's end, which did not create it.
    removed = client.delete(
        f"/issues/{b['id']}/links/{link_id}", headers=team["headers"]
    )
    assert removed.status_code == 204
    assert links_of(client, team, a)["blocks"] == []
    assert links_of(client, team, b)["blocked_by"] == []


def test_a_link_cannot_be_removed_through_an_unrelated_issue(client, team):
    a, b = make_issue(client, team, "A"), make_issue(client, team, "B")
    c = make_issue(client, team, "C")
    link_id = link(client, team, a, b).json()["id"]

    response = client.delete(
        f"/issues/{c['id']}/links/{link_id}", headers=team["headers"]
    )
    assert response.status_code == 404
    assert len(links_of(client, team, a)["blocks"]) == 1


def test_deleting_an_issue_removes_its_links_from_both_ends(client, team):
    a, b = make_issue(client, team, "A"), make_issue(client, team, "B")
    link(client, team, a, b)

    assert (
        client.delete(f"/issues/{a['id']}", headers=team["headers"]).status_code == 204
    )
    # B survives, and no longer claims to be blocked by something gone.
    assert links_of(client, team, b)["blocked_by"] == []


# --- the board's blocked marker ----------------------------------------


def test_an_issue_with_an_open_blocker_reports_it(client, team):
    blocker, blocked = make_issue(client, team, "A"), make_issue(client, team, "B")
    link(client, team, blocker, blocked)

    fetched = client.get(f"/issues/{blocked['id']}", headers=team["headers"]).json()
    assert fetched["blocked_by_count"] == 1
    assert (
        client.get(f"/issues/{blocker['id']}", headers=team["headers"]).json()[
            "blocked_by_count"
        ]
        == 0
    )


@pytest.mark.parametrize("resolved", ["done", "cancelled"])
def test_a_finished_blocker_stops_counting(client, team, resolved):
    """An issue is blocked by outstanding work, not by work that once blocked it."""
    blocker, blocked = make_issue(client, team, "A"), make_issue(client, team, "B")
    link(client, team, blocker, blocked)

    client.patch(
        f"/issues/{blocker['id']}", json={"status": resolved}, headers=team["headers"]
    )
    fetched = client.get(f"/issues/{blocked['id']}", headers=team["headers"]).json()
    assert fetched["blocked_by_count"] == 0


def test_several_blockers_are_counted(client, team):
    blocked = make_issue(client, team, "Blocked")
    for name in "ABC":
        link(client, team, make_issue(client, team, name), blocked)

    fetched = client.get(f"/issues/{blocked['id']}", headers=team["headers"]).json()
    assert fetched["blocked_by_count"] == 3


def test_the_list_endpoint_reports_blockers_too(client, team):
    """The list builds IssueRead by a different path than the detail route."""
    blocker, blocked = make_issue(client, team, "A"), make_issue(client, team, "B")
    link(client, team, blocker, blocked)

    items = client.get(
        f"/teams/{team['team']['id']}/issues", headers=team["headers"]
    ).json()["items"]
    counts = {item["title"]: item["blocked_by_count"] for item in items}
    assert counts == {"A": 0, "B": 1}

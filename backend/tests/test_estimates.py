"""Story points: the field, its validation, and the team rollups (issue #17)."""

import pytest


def make_issue(client, team, title="Sized work", **fields):
    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": title, **fields},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def summary(client, team):
    response = client.get(
        f"/teams/{team['team']['id']}/estimates", headers=team["headers"]
    )
    assert response.status_code == 200, response.text
    return response.json()


# --- the field ---------------------------------------------------------


@pytest.mark.parametrize("points", [1, 2, 3, 5, 8])
def test_every_point_on_the_scale_is_accepted(client, team, points):
    assert make_issue(client, team, estimate=points)["estimate"] == points


def test_an_issue_starts_unsized(client, team):
    assert make_issue(client, team)["estimate"] is None


@pytest.mark.parametrize("points", [0, 4, 6, 7, 13, -1, 100])
def test_a_value_off_the_scale_is_rejected(client, team, points):
    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": "Bad estimate", "estimate": points},
        headers=team["headers"],
    )
    assert response.status_code == 422


def test_the_rejection_names_the_scale(client, team):
    """A 422 a person can act on, rather than a bare type error."""
    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": "Bad estimate", "estimate": 7},
        headers=team["headers"],
    )
    message = response.text
    assert "1, 2, 3, 5, 8" in message
    assert "7" in message


def test_an_estimate_can_be_set_and_changed_later(client, team):
    issue = make_issue(client, team)
    updated = client.patch(
        f"/issues/{issue['id']}", json={"estimate": 5}, headers=team["headers"]
    )
    assert updated.json()["estimate"] == 5

    again = client.patch(
        f"/issues/{issue['id']}", json={"estimate": 8}, headers=team["headers"]
    )
    assert again.json()["estimate"] == 8


def test_an_estimate_can_be_cleared(client, team):
    """An explicit null means "unsize this", and must not be ignored."""
    issue = make_issue(client, team, estimate=3)
    cleared = client.patch(
        f"/issues/{issue['id']}", json={"estimate": None}, headers=team["headers"]
    )
    assert cleared.json()["estimate"] is None


def test_an_omitted_estimate_leaves_the_stored_one_alone(client, team):
    """The other half of the pair above: omitted is not the same as null."""
    issue = make_issue(client, team, estimate=3)
    patched = client.patch(
        f"/issues/{issue['id']}", json={"title": "Renamed"}, headers=team["headers"]
    )
    assert patched.json()["estimate"] == 3


def test_the_estimate_survives_the_list_endpoint(client, team):
    """The list builds IssueRead by a different path than the detail route."""
    make_issue(client, team, estimate=8)
    listed = client.get(
        f"/teams/{team['team']['id']}/issues", headers=team["headers"]
    ).json()
    assert [item["estimate"] for item in listed["items"]] == [8]


# --- the rollups -------------------------------------------------------


def test_an_empty_team_reports_zeroes_for_every_column(client, team):
    data = summary(client, team)
    assert data["total_points"] == 0
    assert data["total_issues"] == 0
    # All six columns are present so the board never has to guard on a key.
    assert set(data["by_status"]) == {
        "backlog",
        "todo",
        "in_progress",
        "in_review",
        "done",
        "cancelled",
    }
    assert all(bucket["points"] == 0 for bucket in data["by_status"].values())


def test_points_are_summed_per_column(client, team):
    make_issue(client, team, estimate=3, status="todo")
    make_issue(client, team, estimate=5, status="todo")
    make_issue(client, team, estimate=8, status="done")

    data = summary(client, team)
    assert data["by_status"]["todo"]["points"] == 8
    assert data["by_status"]["todo"]["issue_count"] == 2
    assert data["by_status"]["done"]["points"] == 8
    assert data["total_points"] == 16
    assert data["total_issues"] == 3


def test_unsized_issues_are_counted_not_treated_as_zero(client, team):
    make_issue(client, team, estimate=5, status="todo")
    make_issue(client, team, status="todo")

    data = summary(client, team)
    assert data["by_status"]["todo"] == {
        "points": 5,
        "issue_count": 2,
        "unestimated_count": 1,
    }
    assert data["unestimated_issues"] == 1


def test_points_are_summed_per_assignee(client, team, auth):
    other = auth(email="second@softtrack.dev", full_name="Second User")
    client.post(
        f"/teams/{team['team']['id']}/members",
        json={"user_id": other["user"]["id"]},
        headers=team["headers"],
    )

    make_issue(client, team, estimate=8, assignee_id=team["user"]["id"])
    make_issue(client, team, estimate=3, assignee_id=other["user"]["id"])
    make_issue(client, team, estimate=2)  # unassigned

    loads = summary(client, team)["by_assignee"]
    assert [load["points"] for load in loads] == [8, 3, 2]
    assert [load["user"] and load["user"]["id"] for load in loads] == [
        team["user"]["id"],
        other["user"]["id"],
        None,
    ]


def test_unassigned_work_sorts_last_however_heavy(client, team):
    """It is a backlog to distribute, not somebody's load."""
    make_issue(client, team, estimate=8)
    make_issue(client, team, estimate=8)
    make_issue(client, team, estimate=1, assignee_id=team["user"]["id"])

    loads = summary(client, team)["by_assignee"]
    assert loads[-1]["user"] is None
    assert loads[-1]["points"] == 16


def test_the_summary_does_not_leak_across_teams(client, team, auth):
    make_issue(client, team, estimate=8)

    outsider = auth(email="outsider@softtrack.dev", full_name="Outsider")
    response = client.get(
        f"/teams/{team['team']['id']}/estimates", headers=outsider["headers"]
    )
    assert response.status_code in (403, 404)

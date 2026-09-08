"""Cycles: time-boxed iterations (issue #16)."""

from datetime import datetime, timedelta, timezone

import pytest

START = datetime(2026, 1, 5, tzinfo=timezone.utc)


def make_cycle(client, team, name=None, start=START, days=14):
    response = client.post(
        f"/teams/{team['team']['id']}/cycles",
        json={
            "name": name,
            "starts_at": start.isoformat(),
            "ends_at": (start + timedelta(days=days)).isoformat(),
        },
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def make_issue(client, team, title="Work", **fields):
    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": title, **fields},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def get_cycle(client, team, cycle):
    response = client.get(f"/cycles/{cycle['id']}", headers=team["headers"])
    assert response.status_code == 200, response.text
    return response.json()


# --- creating -----------------------------------------------------------


def test_a_cycle_is_numbered_per_team(client, team):
    assert make_cycle(client, team)["number"] == 1
    assert make_cycle(client, team, start=START + timedelta(days=14))["number"] == 2


def test_an_unnamed_cycle_still_has_something_to_call_it(client, team):
    """So no client has to invent a label."""
    assert make_cycle(client, team)["display_name"] == "Cycle 1"


def test_a_name_is_used_when_given(client, team):
    assert make_cycle(client, team, name="Hardening")["display_name"] == "Hardening"


def test_a_cycle_starts_upcoming(client, team):
    assert make_cycle(client, team)["state"] == "upcoming"


def test_a_cycle_must_end_after_it_starts(client, team):
    response = client.post(
        f"/teams/{team['team']['id']}/cycles",
        json={
            "starts_at": START.isoformat(),
            "ends_at": (START - timedelta(days=1)).isoformat(),
        },
        headers=team["headers"],
    )
    assert response.status_code == 422


def test_numbering_does_not_reuse_a_deleted_cycle_s_number(client, team):
    """ "Cycle 7" has to keep meaning the same fortnight."""
    first = make_cycle(client, team)
    client.delete(f"/cycles/{first['id']}", headers=team["headers"])
    assert make_cycle(client, team, start=START + timedelta(days=14))["number"] == 2


# --- starting and completing --------------------------------------------


def test_starting_a_cycle_makes_it_active(client, team):
    cycle = make_cycle(client, team)
    started = client.post(f"/cycles/{cycle['id']}/start", headers=team["headers"])
    assert started.status_code == 200
    assert started.json()["state"] == "active"


def test_only_one_cycle_can_be_active_at_a_time(client, team):
    """Otherwise "the current cycle" is ambiguous for every burndown."""
    first = make_cycle(client, team, name="First")
    second = make_cycle(client, team, start=START + timedelta(days=14))
    client.post(f"/cycles/{first['id']}/start", headers=team["headers"])

    response = client.post(f"/cycles/{second['id']}/start", headers=team["headers"])
    assert response.status_code == 409
    assert "First" in response.json()["detail"]


def test_a_second_cycle_can_start_once_the_first_completes(client, team):
    first = make_cycle(client, team)
    second = make_cycle(client, team, start=START + timedelta(days=14))
    client.post(f"/cycles/{first['id']}/start", headers=team["headers"])
    client.post(f"/cycles/{first['id']}/complete", headers=team["headers"])

    assert (
        client.post(
            f"/cycles/{second['id']}/start", headers=team["headers"]
        ).status_code
        == 200
    )


def test_starting_an_already_active_cycle_is_a_no_op(client, team):
    cycle = make_cycle(client, team)
    client.post(f"/cycles/{cycle['id']}/start", headers=team["headers"])
    again = client.post(f"/cycles/{cycle['id']}/start", headers=team["headers"])
    assert again.status_code == 200
    assert again.json()["state"] == "active"


def test_a_completed_cycle_cannot_be_restarted_or_edited_or_deleted(client, team):
    cycle = make_cycle(client, team)
    client.post(f"/cycles/{cycle['id']}/complete", headers=team["headers"])

    assert (
        client.post(f"/cycles/{cycle['id']}/start", headers=team["headers"]).status_code
        == 409
    )
    assert (
        client.patch(
            f"/cycles/{cycle['id']}", json={"name": "x"}, headers=team["headers"]
        ).status_code
        == 409
    )
    assert (
        client.delete(f"/cycles/{cycle['id']}", headers=team["headers"]).status_code
        == 409
    )


# --- carry-over ---------------------------------------------------------


def test_unfinished_issues_carry_into_the_next_cycle(client, team):
    first = make_cycle(client, team)
    second = make_cycle(client, team, start=START + timedelta(days=14))

    done = make_issue(
        client, team, "Done", cycle_id=first["id"], status_id=team["status_ids"]["Done"]
    )
    unfinished = make_issue(client, team, "Not done", cycle_id=first["id"])

    result = client.post(
        f"/cycles/{first['id']}/complete", headers=team["headers"]
    ).json()
    assert result["carried_over"] == 1
    assert result["carried_into_cycle_id"] == second["id"]

    assert _cycle_of(client, team, unfinished) == second["id"]
    # Finished work stays where it was done -- that is the historical record.
    assert _cycle_of(client, team, done) == first["id"]


def test_with_no_later_cycle_unfinished_issues_go_to_the_backlog(client, team):
    """Never to a cycle that is over, and never nowhere."""
    only = make_cycle(client, team)
    issue = make_issue(client, team, "Not done", cycle_id=only["id"])

    result = client.post(
        f"/cycles/{only['id']}/complete", headers=team["headers"]
    ).json()
    assert result["carried_over"] == 1
    assert result["carried_into_cycle_id"] is None
    assert _cycle_of(client, team, issue) is None


def test_carry_over_skips_completed_cycles(client, team):
    """Carrying into a completed cycle would rewrite reported history."""
    first = make_cycle(client, team)
    second = make_cycle(client, team, start=START + timedelta(days=14))
    third = make_cycle(client, team, start=START + timedelta(days=28))

    client.post(f"/cycles/{second['id']}/complete", headers=team["headers"])
    issue = make_issue(client, team, "Not done", cycle_id=first["id"])

    result = client.post(
        f"/cycles/{first['id']}/complete", headers=team["headers"]
    ).json()
    assert result["carried_into_cycle_id"] == third["id"]
    assert _cycle_of(client, team, issue) == third["id"]


@pytest.mark.parametrize("status", ["Done", "Cancelled"])
def test_finished_work_does_not_carry(client, team, status):
    """Cancelled counts as finished -- dragging it forward forever is wrong."""
    first = make_cycle(client, team)
    make_cycle(client, team, start=START + timedelta(days=14))
    make_issue(
        client,
        team,
        "Finished",
        cycle_id=first["id"],
        status_id=team["status_ids"][status],
    )

    result = client.post(
        f"/cycles/{first['id']}/complete", headers=team["headers"]
    ).json()
    assert result["carried_over"] == 0


def test_deleting_a_cycle_returns_its_issues_to_the_backlog(client, team):
    cycle = make_cycle(client, team)
    issue = make_issue(client, team, "Work", cycle_id=cycle["id"])

    assert (
        client.delete(f"/cycles/{cycle['id']}", headers=team["headers"]).status_code
        == 204
    )
    survivor = client.get(f"/issues/{issue['id']}", headers=team["headers"])
    assert survivor.status_code == 200
    assert survivor.json()["cycle_id"] is None


# --- progress -----------------------------------------------------------


def test_progress_counts_issues_and_points_separately(client, team):
    """They disagree, and the disagreement is the interesting part."""
    cycle = make_cycle(client, team)
    make_issue(
        client,
        team,
        "A",
        cycle_id=cycle["id"],
        estimate=1,
        status_id=team["status_ids"]["Done"],
    )
    make_issue(
        client,
        team,
        "B",
        cycle_id=cycle["id"],
        estimate=1,
        status_id=team["status_ids"]["Done"],
    )
    make_issue(client, team, "C", cycle_id=cycle["id"], estimate=8)

    progress = get_cycle(client, team, cycle)["progress"]
    assert progress["issues_total"] == 3
    assert progress["issues_completed"] == 2
    assert progress["points_total"] == 10
    assert progress["points_completed"] == 2


def test_cancelled_work_is_not_counted_as_completed(client, team):
    """It was not delivered, so counting it would flatter the burndown."""
    cycle = make_cycle(client, team)
    make_issue(
        client,
        team,
        "A",
        cycle_id=cycle["id"],
        estimate=5,
        status_id=team["status_ids"]["Cancelled"],
    )

    progress = get_cycle(client, team, cycle)["progress"]
    assert progress["issues_completed"] == 0
    assert progress["points_completed"] == 0


def test_unestimated_issues_in_a_cycle_are_reported(client, team):
    """A points total is only as honest as this number is small."""
    cycle = make_cycle(client, team)
    make_issue(client, team, "Sized", cycle_id=cycle["id"], estimate=3)
    make_issue(client, team, "Unsized", cycle_id=cycle["id"])

    assert get_cycle(client, team, cycle)["progress"]["issues_unestimated"] == 1


def test_an_empty_cycle_reports_zeroes(client, team):
    progress = get_cycle(client, team, make_cycle(client, team))["progress"]
    assert progress == {
        "issues_total": 0,
        "issues_completed": 0,
        "points_total": 0,
        "points_completed": 0,
        "issues_unestimated": 0,
    }


# --- issues in cycles ---------------------------------------------------


def test_issues_can_be_filtered_to_a_cycle(client, team):
    cycle = make_cycle(client, team)
    make_issue(client, team, "In cycle", cycle_id=cycle["id"])
    make_issue(client, team, "In backlog")

    page = client.get(
        f"/teams/{team['team']['id']}/issues",
        params={"cycle_id": cycle["id"]},
        headers=team["headers"],
    ).json()
    assert [item["title"] for item in page["items"]] == ["In cycle"]


def test_an_issue_can_be_moved_out_of_a_cycle(client, team):
    cycle = make_cycle(client, team)
    issue = make_issue(client, team, "Work", cycle_id=cycle["id"])

    moved = client.patch(
        f"/issues/{issue['id']}", json={"cycle_id": None}, headers=team["headers"]
    )
    assert moved.json()["cycle_id"] is None


# --- tenancy ------------------------------------------------------------


def test_cycles_are_not_visible_across_teams(client, team, auth):
    cycle = make_cycle(client, team)
    outsider = auth(email="outsider@softtrack.dev", full_name="Outsider")

    assert client.get(
        f"/cycles/{cycle['id']}", headers=outsider["headers"]
    ).status_code in (403, 404)
    assert client.get(
        f"/teams/{team['team']['id']}/cycles", headers=outsider["headers"]
    ).status_code in (403, 404)


def _cycle_of(client, team, issue):
    return client.get(f"/issues/{issue['id']}", headers=team["headers"]).json()[
        "cycle_id"
    ]

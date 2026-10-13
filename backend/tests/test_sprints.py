"""Sprints: time-boxed iterations (issue #16)."""

from datetime import datetime, timedelta, timezone

import pytest

START = datetime(2026, 1, 5, tzinfo=timezone.utc)


def make_sprint(client, team, name=None, start=START, days=14):
    response = client.post(
        f"/teams/{team['team']['id']}/sprints",
        json={
            "name": name,
            "starts_at": start.isoformat(),
            "ends_at": (start + timedelta(days=days)).isoformat(),
        },
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def make_ticket(client, team, title="Work", **fields):
    response = client.post(
        f"/teams/{team['team']['id']}/tickets",
        json={"title": title, **fields},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def get_sprint(client, team, sprint):
    response = client.get(f"/sprints/{sprint['id']}", headers=team["headers"])
    assert response.status_code == 200, response.text
    return response.json()


# --- creating -----------------------------------------------------------


def test_a_sprint_is_numbered_per_team(client, team):
    assert make_sprint(client, team)["number"] == 1
    assert make_sprint(client, team, start=START + timedelta(days=14))["number"] == 2


def test_an_unnamed_sprint_still_has_something_to_call_it(client, team):
    """So no client has to invent a label."""
    assert make_sprint(client, team)["display_name"] == "Sprint 1"


def test_a_name_is_used_when_given(client, team):
    assert make_sprint(client, team, name="Hardening")["display_name"] == "Hardening"


def test_a_sprint_starts_upcoming(client, team):
    assert make_sprint(client, team)["state"] == "upcoming"


def test_a_sprint_must_end_after_it_starts(client, team):
    response = client.post(
        f"/teams/{team['team']['id']}/sprints",
        json={
            "starts_at": START.isoformat(),
            "ends_at": (START - timedelta(days=1)).isoformat(),
        },
        headers=team["headers"],
    )
    assert response.status_code == 422


def test_numbering_does_not_reuse_a_deleted_sprint_s_number(client, team):
    """ "Sprint 7" has to keep meaning the same fortnight."""
    first = make_sprint(client, team)
    client.delete(f"/sprints/{first['id']}", headers=team["headers"])
    assert make_sprint(client, team, start=START + timedelta(days=14))["number"] == 2


# --- starting and completing --------------------------------------------


def test_starting_a_sprint_makes_it_active(client, team):
    sprint = make_sprint(client, team)
    started = client.post(f"/sprints/{sprint['id']}/start", headers=team["headers"])
    assert started.status_code == 200
    assert started.json()["state"] == "active"


def test_only_one_sprint_can_be_active_at_a_time(client, team):
    """Otherwise "the current sprint" is ambiguous for every burndown."""
    first = make_sprint(client, team, name="First")
    second = make_sprint(client, team, start=START + timedelta(days=14))
    client.post(f"/sprints/{first['id']}/start", headers=team["headers"])

    response = client.post(f"/sprints/{second['id']}/start", headers=team["headers"])
    assert response.status_code == 409
    assert "First" in response.json()["detail"]


def test_a_second_sprint_can_start_once_the_first_completes(client, team):
    first = make_sprint(client, team)
    second = make_sprint(client, team, start=START + timedelta(days=14))
    client.post(f"/sprints/{first['id']}/start", headers=team["headers"])
    client.post(f"/sprints/{first['id']}/complete", headers=team["headers"])

    assert (
        client.post(
            f"/sprints/{second['id']}/start", headers=team["headers"]
        ).status_code
        == 200
    )


def test_starting_an_already_active_sprint_is_a_no_op(client, team):
    sprint = make_sprint(client, team)
    client.post(f"/sprints/{sprint['id']}/start", headers=team["headers"])
    again = client.post(f"/sprints/{sprint['id']}/start", headers=team["headers"])
    assert again.status_code == 200
    assert again.json()["state"] == "active"


def test_a_completed_sprint_cannot_be_restarted_or_edited_or_deleted(client, team):
    sprint = make_sprint(client, team)
    client.post(f"/sprints/{sprint['id']}/complete", headers=team["headers"])

    assert (
        client.post(
            f"/sprints/{sprint['id']}/start", headers=team["headers"]
        ).status_code
        == 409
    )
    assert (
        client.patch(
            f"/sprints/{sprint['id']}", json={"name": "x"}, headers=team["headers"]
        ).status_code
        == 409
    )
    assert (
        client.delete(f"/sprints/{sprint['id']}", headers=team["headers"]).status_code
        == 409
    )


# --- carry-over ---------------------------------------------------------


def test_unfinished_tickets_carry_into_the_next_sprint(client, team):
    first = make_sprint(client, team)
    second = make_sprint(client, team, start=START + timedelta(days=14))

    done = make_ticket(
        client,
        team,
        "Done",
        sprint_id=first["id"],
        status_id=team["status_ids"]["Done"],
    )
    unfinished = make_ticket(client, team, "Not done", sprint_id=first["id"])

    result = client.post(
        f"/sprints/{first['id']}/complete", headers=team["headers"]
    ).json()
    assert result["carried_over"] == 1
    assert result["carried_into_sprint_id"] == second["id"]

    assert _sprint_of(client, team, unfinished) == second["id"]
    # Finished work stays where it was done -- that is the historical record.
    assert _sprint_of(client, team, done) == first["id"]


def test_with_no_later_sprint_unfinished_tickets_go_to_the_backlog(client, team):
    """Never to a sprint that is over, and never nowhere."""
    only = make_sprint(client, team)
    ticket = make_ticket(client, team, "Not done", sprint_id=only["id"])

    result = client.post(
        f"/sprints/{only['id']}/complete", headers=team["headers"]
    ).json()
    assert result["carried_over"] == 1
    assert result["carried_into_sprint_id"] is None
    assert _sprint_of(client, team, ticket) is None


def test_carry_over_skips_completed_sprints(client, team):
    """Carrying into a completed sprint would rewrite reported history."""
    first = make_sprint(client, team)
    second = make_sprint(client, team, start=START + timedelta(days=14))
    third = make_sprint(client, team, start=START + timedelta(days=28))

    client.post(f"/sprints/{second['id']}/complete", headers=team["headers"])
    ticket = make_ticket(client, team, "Not done", sprint_id=first["id"])

    result = client.post(
        f"/sprints/{first['id']}/complete", headers=team["headers"]
    ).json()
    assert result["carried_into_sprint_id"] == third["id"]
    assert _sprint_of(client, team, ticket) == third["id"]


@pytest.mark.parametrize("status", ["Done", "Cancelled"])
def test_finished_work_does_not_carry(client, team, status):
    """Cancelled counts as finished -- dragging it forward forever is wrong."""
    first = make_sprint(client, team)
    make_sprint(client, team, start=START + timedelta(days=14))
    make_ticket(
        client,
        team,
        "Finished",
        sprint_id=first["id"],
        status_id=team["status_ids"][status],
    )

    result = client.post(
        f"/sprints/{first['id']}/complete", headers=team["headers"]
    ).json()
    assert result["carried_over"] == 0


def test_deleting_a_sprint_returns_its_tickets_to_the_backlog(client, team):
    sprint = make_sprint(client, team)
    ticket = make_ticket(client, team, "Work", sprint_id=sprint["id"])

    assert (
        client.delete(f"/sprints/{sprint['id']}", headers=team["headers"]).status_code
        == 204
    )
    survivor = client.get(f"/tickets/{ticket['id']}", headers=team["headers"])
    assert survivor.status_code == 200
    assert survivor.json()["sprint_id"] is None


# --- progress -----------------------------------------------------------


def test_progress_counts_tickets_and_points_separately(client, team):
    """They disagree, and the disagreement is the interesting part."""
    sprint = make_sprint(client, team)
    make_ticket(
        client,
        team,
        "A",
        sprint_id=sprint["id"],
        estimate=1,
        status_id=team["status_ids"]["Done"],
    )
    make_ticket(
        client,
        team,
        "B",
        sprint_id=sprint["id"],
        estimate=1,
        status_id=team["status_ids"]["Done"],
    )
    make_ticket(client, team, "C", sprint_id=sprint["id"], estimate=8)

    progress = get_sprint(client, team, sprint)["progress"]
    assert progress["tickets_total"] == 3
    assert progress["tickets_completed"] == 2
    assert progress["points_total"] == 10
    assert progress["points_completed"] == 2


def test_cancelled_work_is_not_counted_as_completed(client, team):
    """It was not delivered, so counting it would flatter the burndown."""
    sprint = make_sprint(client, team)
    make_ticket(
        client,
        team,
        "A",
        sprint_id=sprint["id"],
        estimate=5,
        status_id=team["status_ids"]["Cancelled"],
    )

    progress = get_sprint(client, team, sprint)["progress"]
    assert progress["tickets_completed"] == 0
    assert progress["points_completed"] == 0


def test_unestimated_tickets_in_a_sprint_are_reported(client, team):
    """A points total is only as honest as this number is small."""
    sprint = make_sprint(client, team)
    make_ticket(client, team, "Sized", sprint_id=sprint["id"], estimate=3)
    make_ticket(client, team, "Unsized", sprint_id=sprint["id"])

    assert get_sprint(client, team, sprint)["progress"]["tickets_unestimated"] == 1


def test_an_empty_sprint_reports_zeroes(client, team):
    progress = get_sprint(client, team, make_sprint(client, team))["progress"]
    assert progress == {
        "tickets_total": 0,
        "tickets_completed": 0,
        "points_total": 0,
        "points_completed": 0,
        "tickets_unestimated": 0,
    }


# --- tickets in sprints ---------------------------------------------------


def test_tickets_can_be_filtered_to_a_sprint(client, team):
    sprint = make_sprint(client, team)
    make_ticket(client, team, "In sprint", sprint_id=sprint["id"])
    make_ticket(client, team, "In backlog")

    page = client.get(
        f"/teams/{team['team']['id']}/tickets",
        params={"sprint_id": sprint["id"]},
        headers=team["headers"],
    ).json()
    assert [item["title"] for item in page["items"]] == ["In sprint"]


def test_a_ticket_can_be_moved_out_of_a_sprint(client, team):
    sprint = make_sprint(client, team)
    ticket = make_ticket(client, team, "Work", sprint_id=sprint["id"])

    moved = client.patch(
        f"/tickets/{ticket['id']}", json={"sprint_id": None}, headers=team["headers"]
    )
    assert moved.json()["sprint_id"] is None


# --- tenancy ------------------------------------------------------------


def test_sprints_are_not_visible_across_teams(client, team, auth):
    sprint = make_sprint(client, team)
    outsider = auth(email="outsider@softtrack.dev", full_name="Outsider")

    assert client.get(
        f"/sprints/{sprint['id']}", headers=outsider["headers"]
    ).status_code in (403, 404)
    assert client.get(
        f"/teams/{team['team']['id']}/sprints", headers=outsider["headers"]
    ).status_code in (403, 404)


def _sprint_of(client, team, ticket):
    return client.get(f"/tickets/{ticket['id']}", headers=team["headers"]).json()[
        "sprint_id"
    ]

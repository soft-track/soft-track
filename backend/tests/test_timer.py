"""A timer on a ticket (#266)."""

import time
from datetime import datetime

import pytest
from sqlmodel import select

from lib_softtrack.tables import Timer
from tests.conftest import delete_for_good


def join(client, team, person, role="member"):
    response = client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": person["user"]["email"], "role": role},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text


def make_ticket(client, actor, team_id, **fields):
    response = client.post(
        f"/teams/{team_id}/tickets",
        json={"title": "Fix memory leak", **fields},
        headers=actor["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def ticket(client, team):
    return make_ticket(client, team, team["team"]["id"])


@pytest.fixture
def other_ticket(client, team):
    return make_ticket(client, team, team["team"]["id"], title="Second ticket")


@pytest.fixture
def maya(client, team, auth):
    person = auth(email="maya@softtrack.dev", full_name="Maya Chen")
    join(client, team, person)
    return person


def test_no_timer_initially(client, team):
    response = client.get("/me/timer", headers=team["headers"])
    assert response.status_code == 200
    assert response.json() is None


def test_start_timer_on_ticket(client, team, ticket):
    response = client.post(f"/tickets/{ticket['id']}/timer", headers=team["headers"])
    assert response.status_code == 200
    timer = response.json()
    assert timer["ticket_id"] == ticket["id"]
    assert timer["ticket_identifier"] == ticket["identifier"]
    assert timer["ticket_team_key"] == team["team"]["key"]
    assert timer["ticket_number"] == ticket["number"]
    assert timer["is_paused"] is False
    assert timer["paused_at"] is None
    assert timer["duration_seconds"] >= 0

    # GET /me/timer returns the same timer
    get_res = client.get("/me/timer", headers=team["headers"])
    assert get_res.status_code == 200
    assert get_res.json()["ticket_id"] == ticket["id"]


def test_pause_and_resume_timer(client, team, ticket):
    client.post(f"/tickets/{ticket['id']}/timer", headers=team["headers"])

    # Pause
    pause_res = client.patch(
        "/me/timer", json={"paused": True}, headers=team["headers"]
    )
    assert pause_res.status_code == 200
    timer = pause_res.json()
    assert timer["is_paused"] is True
    assert timer["paused_at"] is not None

    # Resume
    resume_res = client.patch(
        "/me/timer", json={"paused": False}, headers=team["headers"]
    )
    assert resume_res.status_code == 200
    timer = resume_res.json()
    assert timer["is_paused"] is False
    assert timer["paused_at"] is None


def test_patch_me_timer(client, team, ticket):
    client.post(f"/tickets/{ticket['id']}/timer", headers=team["headers"])

    # Patch pause
    res = client.patch("/me/timer", json={"paused": True}, headers=team["headers"])
    assert res.status_code == 200
    assert res.json()["is_paused"] is True

    # Patch resume
    res = client.patch("/me/timer", json={"paused": False}, headers=team["headers"])
    assert res.status_code == 200
    assert res.json()["is_paused"] is False


def test_starting_same_ticket_resumes_if_paused(client, team, ticket):
    client.post(f"/tickets/{ticket['id']}/timer", headers=team["headers"])
    client.patch("/me/timer", json={"paused": True}, headers=team["headers"])
    assert client.get("/me/timer", headers=team["headers"]).json()["is_paused"] is True

    # Starting on the same ticket resumes
    res = client.post(f"/tickets/{ticket['id']}/timer", headers=team["headers"])
    assert res.status_code == 200
    assert res.json()["is_paused"] is False


def test_one_timer_per_person_starting_second_replaces_first(
    client, team, ticket, other_ticket
):
    client.post(f"/tickets/{ticket['id']}/timer", headers=team["headers"])
    assert (
        client.get("/me/timer", headers=team["headers"]).json()["ticket_id"]
        == ticket["id"]
    )

    # Start timer on other_ticket
    res = client.post(f"/tickets/{other_ticket['id']}/timer", headers=team["headers"])
    assert res.status_code == 200
    assert res.json()["ticket_id"] == other_ticket["id"]

    # Only one timer exists
    get_res = client.get("/me/timer", headers=team["headers"])
    assert get_res.json()["ticket_id"] == other_ticket["id"]


def test_discard_timer(client, team, ticket):
    client.post(f"/tickets/{ticket['id']}/timer", headers=team["headers"])
    del_res = client.delete("/me/timer", headers=team["headers"])
    assert del_res.status_code == 204

    get_res = client.get("/me/timer", headers=team["headers"])
    assert get_res.json() is None


def test_guests_cannot_start_timer(client, team, auth, ticket):
    guest = auth(email="guest@softtrack.dev", full_name="Guest User")
    join(client, team, guest, "guest")

    response = client.post(f"/tickets/{ticket['id']}/timer", headers=guest["headers"])
    assert response.status_code == 403
    assert response.json()["code"] == "team_read_only"


def test_outsider_cannot_start_timer(client, auth, ticket):
    stranger = auth(email="stranger@softtrack.dev", full_name="Stranger")
    response = client.post(
        f"/tickets/{ticket['id']}/timer", headers=stranger["headers"]
    )
    assert response.status_code == 403


def test_deleting_ticket_cleans_up_timer(client, team, ticket, session):
    client.post(f"/tickets/{ticket['id']}/timer", headers=team["headers"])
    assert client.get("/me/timer", headers=team["headers"]).json() is not None

    delete_for_good(client, team["headers"], ticket["id"])
    assert client.get("/me/timer", headers=team["headers"]).json() is None


def test_multiple_users_have_independent_timers(
    client, team, maya, ticket, other_ticket
):
    client.post(f"/tickets/{ticket['id']}/timer", headers=team["headers"])
    client.post(f"/tickets/{other_ticket['id']}/timer", headers=maya["headers"])

    timer_team = client.get("/me/timer", headers=team["headers"]).json()
    timer_maya = client.get("/me/timer", headers=maya["headers"]).json()

    assert timer_team["ticket_id"] == ticket["id"]
    assert timer_maya["ticket_id"] == other_ticket["id"]

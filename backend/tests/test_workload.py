"""Workload (#127): everything open assigned to one person, in the teams the
viewer shares with them, grouped by team, with the totals from the database."""

import pytest

from tests.conftest import status_ids


@pytest.fixture
def org(client, auth):
    """Amina manages Daniel and Kenji, and owns Engineering, which both are on.
    Daniel also owns Support, which Amina is not on."""
    people = {
        "amina": auth(email="amina@northwind.dev", full_name="Amina Khan"),
        "daniel": auth(email="daniel@northwind.dev", full_name="Daniel Okafor"),
        "kenji": auth(email="kenji@northwind.dev", full_name="Kenji Watanabe"),
    }
    amina, daniel = people["amina"], people["daniel"]

    def team(owner, name, key, members):
        created = client.post(
            "/teams", json={"name": name, "key": key}, headers=owner["headers"]
        ).json()
        for member in members:
            client.post(
                f"/teams/{created['id']}/members",
                json={"email": member["user"]["email"]},
                headers=owner["headers"],
            )
        return created

    eng = team(amina, "Engineering", "ENG", [daniel, people["kenji"]])
    sup = team(daniel, "Support", "SUP", [])
    for report in ("daniel", "kenji"):
        client.patch(
            f"/admin/users/{people[report]['user']['id']}",
            json={"manager_id": amina["user"]["id"]},
            headers=amina["headers"],
        )
    return {
        **people,
        "eng": eng,
        "sup": sup,
        "eng_status": status_ids(client, amina, eng["id"]),
        "sup_status": status_ids(client, daniel, sup["id"]),
    }


def _ticket(client, owner, team, title, **fields):
    response = client.post(
        f"/teams/{team['id']}/tickets",
        json={"title": title, **fields},
        headers=owner["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def plate(client, org):
    """Daniel's work: three open and two finished on Engineering, two open on
    Support."""
    amina, daniel = org["amina"], org["daniel"]
    on_eng = dict(assignee_id=daniel["user"]["id"])
    eng, status = org["eng"], org["eng_status"]
    sprint = client.post(
        f"/teams/{eng['id']}/sprints",
        json={"starts_at": "2026-09-21T00:00:00", "ends_at": "2026-10-05T00:00:00"},
        headers=amina["headers"],
    ).json()
    _ticket(
        client,
        amina,
        eng,
        "Rate-limit the comment endpoint",
        status_id=status["Todo"],
        priority="high",
        estimate=3,
        **on_eng,
    )
    _ticket(
        client,
        amina,
        eng,
        "Batch the digest",
        status_id=status["In Progress"],
        priority="urgent",
        estimate=5,
        sprint_id=sprint["id"],
        **on_eng,
    )
    _ticket(
        client,
        amina,
        eng,
        "Alert on failed sends",
        status_id=status["Backlog"],
        priority="low",
        **on_eng,
    )
    _ticket(
        client,
        amina,
        eng,
        "Shipped already",
        status_id=status["Done"],
        estimate=8,
        **on_eng,
    )
    _ticket(
        client,
        amina,
        eng,
        "Dropped",
        status_id=status["Cancelled"],
        estimate=2,
        **on_eng,
    )
    # Somebody else's, on the same board: not Daniel's plate.
    _ticket(
        client,
        amina,
        eng,
        "Kenji's",
        status_id=status["Todo"],
        estimate=8,
        assignee_id=org["kenji"]["user"]["id"],
    )
    for title in ("Refund a customer", "Reply to the tax office"):
        _ticket(
            client,
            daniel,
            org["sup"],
            title,
            status_id=org["sup_status"]["Todo"],
            estimate=2,
            assignee_id=daniel["user"]["id"],
        )
    return org


def _workload(client, viewer, username, **params):
    response = client.get(
        f"/users/{username}/workload", params=params, headers=viewer["headers"]
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_only_open_work_in_the_teams_you_share_is_listed_or_counted(client, plate):
    # Amina is a site admin, and still sees nothing of Support: this is a
    # working view, not an audit.
    body = _workload(client, plate["amina"], "daniel")
    assert (body["open_count"], body["points"]) == (3, 8)
    [eng] = body["teams"]
    assert eng["team"]["key"] == "ENG"
    assert (eng["open_count"], eng["points"]) == (3, 8)


def test_in_flight_first_then_accepted_then_the_backlog(client, plate):
    [eng] = _workload(client, plate["amina"], "daniel")["teams"]
    rows = [
        (t["identifier"][:4], t["title"], t["status"]["name"]) for t in eng["tickets"]
    ]
    assert rows == [
        ("ENG-", "Batch the digest", "In Progress"),
        ("ENG-", "Rate-limit the comment endpoint", "Todo"),
        ("ENG-", "Alert on failed sends", "Backlog"),
    ]
    first = eng["tickets"][0]
    assert (first["priority"], first["estimate"], first["sprint"]) == (
        "urgent",
        5,
        "Sprint 1",
    )
    assert eng["tickets"][2]["sprint"] is None


def test_your_own_plate_is_every_team_you_are_on(client, plate):
    body = _workload(client, plate["daniel"], "daniel")
    assert (body["open_count"], body["points"]) == (5, 12)
    assert [group["team"]["key"] for group in body["teams"]] == ["ENG", "SUP"]


def test_nothing_open_in_a_shared_team_is_an_empty_plate(client, plate):
    body = _workload(client, plate["amina"], "kenji")
    assert body["open_count"] == 1  # the one on Engineering

    # And somebody who shares no team with Daniel sees nothing of his.
    stranger = client.post(
        "/auth/register",
        json={
            "email": "lina@northwind.dev",
            "password": "password123",
            "full_name": "Lina",
        },
    ).json()
    headers = {"Authorization": f"Bearer {stranger['access_token']}"}
    empty = client.get("/users/daniel/workload", headers=headers).json()
    assert (empty["open_count"], empty["points"], empty["teams"]) == (0, 0, [])


def test_each_team_pages_on_its_own(client, plate):
    body = _workload(client, plate["amina"], "daniel", per_team=2)
    [eng] = body["teams"]
    assert [t["title"] for t in eng["tickets"]] == [
        "Batch the digest",
        "Rate-limit the comment endpoint",
    ]
    # The group's count is still the whole team's, not the page's.
    assert eng["open_count"] == 3

    more = _workload(
        client,
        plate["amina"],
        "daniel",
        per_team=2,
        team_id=plate["eng"]["id"],
        offset=2,
    )
    [eng_page] = more["teams"]
    assert [t["title"] for t in eng_page["tickets"]] == ["Alert on failed sends"]
    assert (eng_page["offset"], more["reports"]) == (2, [])


def test_a_manager_sees_each_reports_load_in_teams_shared_with_them(client, plate):
    # Kenji is on Engineering only, so Daniel's Support work is not his to see.
    by_kenji = _workload(client, plate["kenji"], "amina")["reports"]
    assert [
        (r["person"]["username"], r["open_count"], r["points"]) for r in by_kenji
    ] == [
        ("daniel", 3, 8),
        ("kenji", 1, 8),
    ]
    # Daniel is on both, and sees all of his own.
    by_daniel = _workload(client, plate["daniel"], "amina")["reports"]
    assert by_daniel[0]["open_count"] == 5


def test_a_deactivated_report_is_left_off(client, plate):
    client.patch(
        f"/admin/users/{plate['kenji']['user']['id']}",
        json={"is_active": False},
        headers=plate["amina"]["headers"],
    )
    reports = _workload(client, plate["amina"], "amina")["reports"]
    assert [r["person"]["username"] for r in reports] == ["daniel"]


def test_nobody_by_that_name_is_a_404(client, plate):
    response = client.get("/users/nobody/workload", headers=plate["amina"]["headers"])
    assert response.status_code == 404
    assert response.json()["code"] == "user_not_found"


def test_signed_out_nobody_sees_anything(client, plate):
    assert client.get("/users/daniel/workload").status_code == 401

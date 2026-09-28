"""A profile behind every name (#126): readable by anyone signed in, with the
teams on it cut down to the ones the viewer shares."""

import pytest


@pytest.fixture
def org(client, auth):
    """Amina manages Daniel and Kenji. Daniel is on Engineering and Support;
    Amina is on Engineering only, and Lina on nothing."""
    people = {
        "amina": auth(email="amina@northwind.dev", full_name="Amina Khan"),
        "daniel": auth(email="daniel@northwind.dev", full_name="Daniel Okafor"),
        "kenji": auth(email="kenji@northwind.dev", full_name="Kenji Watanabe"),
        "lina": auth(email="lina@northwind.dev", full_name="Lina Haddad"),
    }
    admin = people["amina"]  # the first account, so the site admin

    def team(owner, name, key, members):
        created = client.post(
            "/teams", json={"name": name, "key": key}, headers=owner["headers"]
        ).json()
        for member in members:
            response = client.post(
                f"/teams/{created['id']}/members",
                json={"email": member["user"]["email"]},
                headers=owner["headers"],
            )
            assert response.status_code == 200, response.text
        return created

    team(people["amina"], "Engineering", "ENG", [people["daniel"], people["kenji"]])
    team(people["daniel"], "Support", "SUP", [])

    for report in ("kenji", "daniel"):
        client.patch(
            f"/admin/users/{people[report]['user']['id']}",
            json={"manager_id": people["amina"]["user"]["id"]},
            headers=admin["headers"],
        )
    client.patch(
        "/auth/me",
        json={"job_title": "Senior Backend Engineer", "location": "Lagos"},
        headers=people["daniel"]["headers"],
    )
    return {"admin": admin, **people}


def _profile(client, viewer, username):
    return client.get(f"/users/{username}", headers=viewer["headers"])


def test_anyone_signed_in_reads_a_profile(client, org):
    # Lina shares no team with anyone, and still reads Daniel's profile.
    response = _profile(client, org["lina"], "daniel")
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["full_name"], body["job_title"], body["location"]) == (
        "Daniel Okafor",
        "Senior Backend Engineer",
        "Lagos",
    )
    assert body["manager"]["username"] == "amina"
    assert "email" not in body


def test_signed_out_nobody_does(client, org):
    assert client.get("/users/daniel").status_code == 401


def test_a_managers_profile_lists_their_reports_by_name(client, org):
    body = _profile(client, org["lina"], "amina").json()
    assert [report["full_name"] for report in body["direct_reports"]] == [
        "Daniel Okafor",
        "Kenji Watanabe",
    ]
    assert body["direct_reports"][0]["job_title"] == "Senior Backend Engineer"


def test_the_teams_on_it_are_only_the_ones_the_viewer_shares(client, org):
    # Amina is on Engineering with Daniel, not on Support.
    seen_by_amina = _profile(client, org["amina"], "daniel").json()["shared_teams"]
    assert [team["key"] for team in seen_by_amina] == ["ENG"]

    # Daniel sees all of his own.
    seen_by_daniel = _profile(client, org["daniel"], "daniel").json()["shared_teams"]
    assert [team["key"] for team in seen_by_daniel] == ["ENG", "SUP"]

    # Lina shares nothing with him, and so learns nothing of his teams.
    assert _profile(client, org["lina"], "daniel").json()["shared_teams"] == []


def test_a_deactivated_account_still_resolves_and_says_so(client, org):
    client.patch(
        f"/admin/users/{org['kenji']['user']['id']}",
        json={"is_active": False},
        headers=org["admin"]["headers"],
    )
    response = _profile(client, org["daniel"], "kenji")
    assert response.status_code == 200
    assert response.json()["is_active"] is False
    # And a deactivated report is nobody's report on a profile.
    reports = _profile(client, org["daniel"], "amina").json()["direct_reports"]
    assert [report["username"] for report in reports] == ["daniel"]


def test_a_username_is_found_whatever_its_case(client, org):
    assert _profile(client, org["lina"], "DANIEL").json()["username"] == "daniel"


def test_nobody_by_that_name_is_a_404(client, org):
    response = _profile(client, org["lina"], "nobody-here")
    assert response.status_code == 404
    assert response.json()["code"] == "user_not_found"

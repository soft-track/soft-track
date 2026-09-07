def test_creating_a_team_makes_the_creator_a_member(client, team):
    response = client.get("/teams", headers=team["headers"])
    assert response.status_code == 200
    assert [t["key"] for t in response.json()] == ["ENG"]


def test_team_keys_are_uppercased(client, auth):
    actor = auth()
    response = client.post(
        "/teams", json={"name": "Design", "key": "dsn"}, headers=actor["headers"]
    )
    assert response.json()["key"] == "DSN"


def test_a_duplicate_team_key_is_rejected(client, team):
    response = client.post(
        "/teams", json={"name": "Other", "key": "ENG"}, headers=team["headers"]
    )
    assert response.status_code == 400


def test_a_non_member_cannot_read_a_team(client, team, auth):
    outsider = auth(email="outsider@softtrack.dev")
    response = client.get(f"/teams/{team['team']['id']}", headers=outsider["headers"])
    assert response.status_code == 403


def test_a_non_member_cannot_list_team_issues(client, team, auth):
    """The tenancy boundary. If this ever returns 200, teams leak into each other."""
    outsider = auth(email="outsider@softtrack.dev")
    response = client.get(
        f"/teams/{team['team']['id']}/issues", headers=outsider["headers"]
    )
    assert response.status_code == 403


def test_listing_teams_only_returns_your_own(client, team, auth):
    outsider = auth(email="outsider@softtrack.dev")
    assert client.get("/teams", headers=outsider["headers"]).json() == []


def test_adding_a_member_by_email(client, team, auth):
    other = auth(email="colleague@softtrack.dev")
    response = client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": "colleague@softtrack.dev"},
        headers=team["headers"],
    )
    assert response.status_code == 200
    assert response.json()["user"]["email"] == "colleague@softtrack.dev"
    # the new member can now see the team
    assert (
        client.get(f"/teams/{team['team']['id']}", headers=other["headers"]).status_code
        == 200
    )


def test_adding_an_unknown_email_is_a_404(client, team):
    response = client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": "ghost@softtrack.dev"},
        headers=team["headers"],
    )
    assert response.status_code == 404

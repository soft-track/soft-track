"""The team directory: every team, its size and its admins (#318).

What somebody on no team reads to know whom to ask. It says who runs a team
and nothing about its work.
"""

from sqlmodel import select

from lib_softtrack.tables import User


def join(client, owner, team_id, email, role="member"):
    response = client.post(
        f"/teams/{team_id}/members",
        json={"email": email, "role": role},
        headers=owner["headers"],
    )
    assert response.status_code == 200, response.text


def directory(client, actor):
    response = client.get("/teams/directory", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def test_somebody_on_no_team_sees_every_team_and_who_runs_it(client, team, auth):
    eng = team["team"]["id"]
    amina = auth(email="amina@softtrack.dev", full_name="Amina Khan")
    auth(email="tomas@softtrack.dev", full_name="Tomas Silva")
    auth(email="carlos@client.dev", full_name="Carlos Rivera")
    join(client, team, eng, "amina@softtrack.dev", role="admin")
    join(client, team, eng, "tomas@softtrack.dev")
    join(client, team, eng, "carlos@client.dev", role="guest")
    client.post(
        "/teams",
        json={"name": "Design", "key": "DES", "description": "Product and brand"},
        headers=amina["headers"],
    )
    yuki = auth(email="yuki@softtrack.dev", full_name="Yuki Tanaka")

    teams = directory(client, yuki)

    assert [(t["name"], t["key"], t["member_count"]) for t in teams] == [
        ("Design", "DES", 1),
        ("Engineering", "ENG", 4),
    ]
    assert teams[0]["description"] == "Product and brand"
    # Admins only, longest-serving first.
    assert [a["full_name"] for a in teams[1]["admins"]] == ["Demo User", "Amina Khan"]
    assert [a["full_name"] for a in teams[0]["admins"]] == ["Amina Khan"]


def test_the_directory_excludes_archived_teams(client, team):
    archived = client.post(
        "/teams",
        json={"name": "Retired", "key": "RET"},
        headers=team["headers"],
    ).json()
    client.patch(
        f"/teams/{archived['id']}",
        json={"archived": True},
        headers=team["headers"],
    )

    teams = directory(client, team)
    assert any(t["key"] == "ENG" for t in teams)
    assert not any(t["id"] == archived["id"] for t in teams)


def test_a_deactivated_account_is_neither_counted_nor_asked(
    client, team, auth, session
):
    eng = team["team"]["id"]
    auth(email="amina@softtrack.dev", full_name="Amina Khan")
    join(client, team, eng, "amina@softtrack.dev", role="admin")
    amina = session.exec(select(User).where(User.email == "amina@softtrack.dev")).one()
    amina.is_active = False
    session.add(amina)
    session.commit()

    (entry,) = directory(client, team)
    assert entry["member_count"] == 1
    assert [a["full_name"] for a in entry["admins"]] == ["Demo User"]


def test_it_says_nothing_about_the_work(client, team):
    client.post(
        f"/teams/{team['team']['id']}/tickets",
        json={"title": "Private roadmap item"},
        headers=team["headers"],
    )
    (entry,) = directory(client, team)
    assert set(entry) == {"id", "name", "key", "description", "member_count", "admins"}
    assert "Private roadmap item" not in str(entry)


def test_it_needs_somebody_signed_in(client, team):
    assert client.get("/teams/directory").status_code == 401


def test_a_team_id_still_reads_as_a_team(client, team):
    """The directory is declared before /teams/{team_id}, which still works."""
    response = client.get(f"/teams/{team['team']['id']}", headers=team["headers"])
    assert response.status_code == 200
    assert response.json()["key"] == "ENG"

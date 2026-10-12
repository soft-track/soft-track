"""Finding a team and asking to join it (#259).

The team directory lists the teams there are, and from it somebody asks to
join one, with an optional note. The team's admins are told and approve with
a role or decline. One open request per person per team, running out when an
invitation would. A team can keep itself off the list, and a team can be open:
anybody signed in joins it as a member without asking.
"""

from datetime import timedelta

import pytest
from sqlmodel import select

from app_softtrack import teams as team_routes
from lib_softtrack.tables import (
    Department,
    Team,
    TeamJoinRequest,
    TeamMember,
    User,
    utcnow,
)
from web import settings


class FakeMailer:
    def __init__(self):
        self.sent: list[tuple[str, str, str]] = []

    def send(self, to: str, subject: str, body: str) -> None:
        self.sent.append((to, subject, body))


@pytest.fixture
def mailer(monkeypatch):
    fake = FakeMailer()
    monkeypatch.setattr(team_routes, "get_mailer", lambda: fake)
    return fake


@pytest.fixture
def eng(client, team, auth):
    """Engineering, run by Demo and Amina; Yuki, on no team, on her first day."""
    amina = auth(email="amina@softtrack.dev", full_name="Amina Khan")
    response = client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": "amina@softtrack.dev", "role": "admin"},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    yuki = auth(email="yuki@softtrack.dev", full_name="Yuki Sato")
    return {"id": team["team"]["id"], "admin": team, "amina": amina, "yuki": yuki}


def directory(client, actor):
    response = client.get("/teams/directory", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def ask(client, actor, team_id, note=None):
    return client.post(
        f"/teams/{team_id}/join-requests",
        json={"note": note} if note is not None else {},
        headers=actor["headers"],
    )


def requests_of(client, admin, team_id):
    response = client.get(f"/teams/{team_id}/join-requests", headers=admin["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def patch_team(client, admin, team_id, **changes):
    response = client.patch(f"/teams/{team_id}", json=changes, headers=admin["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def roles(session, team_id):
    session.expire_all()
    return {
        m.user_id: m.role.value
        for m in session.exec(
            select(TeamMember).where(TeamMember.team_id == team_id)
        ).all()
    }


# --- the directory -----------------------------------------------------------


def test_a_team_is_listed_and_closed_unless_it_says_otherwise(client, eng):
    team = client.get(f"/teams/{eng['id']}", headers=eng["admin"]["headers"]).json()
    assert team["listed"] is True
    assert team["open_to_join"] is False

    (entry,) = directory(client, eng["yuki"])["teams"]
    assert entry["open_to_join"] is False
    assert entry["my_role"] is None
    assert entry["my_request"] is None
    # Its own admin sees where they stand.
    (own,) = directory(client, eng["admin"])["teams"]
    assert own["my_role"] == "admin"


def test_a_team_off_the_list_is_counted_and_not_shown(client, eng, auth):
    lena = auth(email="lena@softtrack.dev", full_name="Lena Fischer")
    hidden = client.post(
        "/teams", json={"name": "Board", "key": "BRD"}, headers=lena["headers"]
    ).json()
    patch_team(client, lena, hidden["id"], listed=False)

    seen = directory(client, eng["yuki"])
    assert [t["key"] for t in seen["teams"]] == ["ENG"]
    assert seen["unlisted_count"] == 1
    # Its members still find it, and it is not counted for them.
    mine = directory(client, lena)
    assert sorted(t["key"] for t in mine["teams"]) == ["BRD", "ENG"]
    assert mine["unlisted_count"] == 0


def test_an_archived_team_is_neither_shown_nor_counted(client, eng, session):
    team = session.get(Team, eng["id"])
    team.archived_at = utcnow()
    session.add(team)
    session.commit()

    seen = directory(client, eng["yuki"])
    assert seen == {"teams": [], "unlisted_count": 0}
    assert ask(client, eng["yuki"], eng["id"]).json()["code"] == "team_not_found"


def test_only_an_admin_decides_how_findable_a_team_is(client, eng, auth):
    tomas = auth(email="tomas@softtrack.dev", full_name="Tomas Silva")
    client.post(
        f"/teams/{eng['id']}/members",
        json={"email": "tomas@softtrack.dev"},
        headers=eng["admin"]["headers"],
    )
    refused = client.patch(
        f"/teams/{eng['id']}", json={"listed": False}, headers=tomas["headers"]
    )
    assert refused.status_code == 403
    assert refused.json()["code"] == "not_team_admin"

    team = patch_team(client, eng["admin"], eng["id"], listed=False, open_to_join=True)
    assert (team["listed"], team["open_to_join"]) == (False, True)


# --- asking ------------------------------------------------------------------


def test_asking_tells_the_admins_and_shows_in_the_directory(client, eng, mailer):
    response = ask(client, eng["yuki"], eng["id"], note="  Amina said Monday.  ")
    assert response.status_code == 200, response.text
    request = response.json()
    assert request["note"] == "Amina said Monday."

    (entry,) = directory(client, eng["yuki"])["teams"]
    assert entry["my_request"]["id"] == request["id"]

    assert sorted(to for to, _, _ in mailer.sent) == [
        "amina@softtrack.dev",
        "demo@softtrack.dev",
    ]
    _, subject, body = mailer.sent[0]
    assert subject == f"Yuki Sato asks to join Engineering on {settings.app_name}"
    assert "“Amina said Monday.”" in body
    assert "/settings/teams/ENG/members" in body


def test_the_note_is_optional(client, eng):
    response = ask(client, eng["yuki"], eng["id"])
    assert response.status_code == 200, response.text
    assert response.json()["note"] is None


def test_one_open_request_per_person_per_team(client, eng):
    assert ask(client, eng["yuki"], eng["id"]).status_code == 200
    again = ask(client, eng["yuki"], eng["id"], note="Again")
    assert again.status_code == 409
    assert again.json()["code"] == "join_request_pending"
    assert len(requests_of(client, eng["admin"], eng["id"])) == 1


def test_a_request_runs_out_when_an_invitation_would(client, eng, session):
    request = ask(client, eng["yuki"], eng["id"]).json()
    row = session.get(TeamJoinRequest, request["id"])
    assert abs(
        (row.expires_at - row.created_at) - timedelta(days=settings.invite_expire_days)
    ) < timedelta(seconds=5)

    row.expires_at = utcnow() - timedelta(minutes=1)
    session.add(row)
    session.commit()

    assert requests_of(client, eng["admin"], eng["id"]) == []
    assert directory(client, eng["yuki"])["teams"][0]["my_request"] is None
    # And once it has, they may ask again.
    assert ask(client, eng["yuki"], eng["id"]).status_code == 200


def test_somebody_on_the_team_does_not_ask(client, eng):
    response = ask(client, eng["amina"], eng["id"])
    assert response.status_code == 400
    assert response.json()["code"] == "already_member"


def test_a_team_off_the_list_cannot_be_asked_or_joined(client, eng):
    patch_team(client, eng["admin"], eng["id"], listed=False, open_to_join=True)
    for response in (
        ask(client, eng["yuki"], eng["id"]),
        client.post(f"/teams/{eng['id']}/join", headers=eng["yuki"]["headers"]),
    ):
        assert response.status_code == 404
        assert response.json()["code"] == "team_not_found"


def test_withdrawing_your_own_request(client, eng):
    request = ask(client, eng["yuki"], eng["id"]).json()
    # Not somebody else's, which answers as if there were none.
    other = client.delete(
        f"/teams/join-requests/{request['id']}", headers=eng["amina"]["headers"]
    )
    assert other.status_code == 404
    assert other.json()["code"] == "join_request_not_found"

    response = client.delete(
        f"/teams/join-requests/{request['id']}", headers=eng["yuki"]["headers"]
    )
    assert response.status_code == 204
    assert requests_of(client, eng["admin"], eng["id"]) == []
    assert directory(client, eng["yuki"])["teams"][0]["my_request"] is None


# --- the admins' side --------------------------------------------------------


def test_the_admin_sees_who_is_asking(client, eng, session):
    ask(client, eng["yuki"], eng["id"], note="Amina said Monday.")
    department = Department(name="Engineering", name_key="engineering")
    session.add(department)
    session.commit()
    yuki = session.get(User, eng["yuki"]["user"]["id"])
    yuki.job_title = "Junior Engineer"
    yuki.department_id = department.id
    yuki.manager_id = eng["amina"]["user"]["id"]
    session.add(yuki)
    session.commit()

    (request,) = requests_of(client, eng["admin"], eng["id"])
    assert request["requester"]["full_name"] == "Yuki Sato"
    assert request["job_title"] == "Junior Engineer"
    assert request["department"] == "Engineering"
    assert request["manager"]["full_name"] == "Amina Khan"
    assert request["note"] == "Amina said Monday."


def test_only_admins_see_the_requests(client, eng, auth):
    tomas = auth(email="tomas@softtrack.dev", full_name="Tomas Silva")
    client.post(
        f"/teams/{eng['id']}/members",
        json={"email": "tomas@softtrack.dev"},
        headers=eng["admin"]["headers"],
    )
    response = client.get(f"/teams/{eng['id']}/join-requests", headers=tomas["headers"])
    assert response.status_code == 403
    assert response.json()["code"] == "not_team_admin"


def test_approving_puts_them_on_the_team_with_the_role_chosen(
    client, eng, session, mailer
):
    request = ask(client, eng["yuki"], eng["id"]).json()
    mailer.sent.clear()

    response = client.post(
        f"/teams/{eng['id']}/join-requests/{request['id']}/approve",
        json={"role": "guest"},
        headers=eng["amina"]["headers"],
    )
    assert response.status_code == 200, response.text
    assert response.json()["role"] == "guest"
    assert roles(session, eng["id"])[eng["yuki"]["user"]["id"]] == "guest"
    assert requests_of(client, eng["admin"], eng["id"]) == []
    ((to, subject, body),) = mailer.sent
    assert to == "yuki@softtrack.dev"
    assert "Amina Khan approved your request to join Engineering" in body
    assert "as a guest" in body


def test_declining_takes_the_request_away_and_tells_them(client, eng, session, mailer):
    request = ask(client, eng["yuki"], eng["id"]).json()
    mailer.sent.clear()

    response = client.post(
        f"/teams/{eng['id']}/join-requests/{request['id']}/decline",
        headers=eng["admin"]["headers"],
    )
    assert response.status_code == 204
    assert eng["yuki"]["user"]["id"] not in roles(session, eng["id"])
    assert requests_of(client, eng["admin"], eng["id"]) == []
    ((to, _, body),) = mailer.sent
    assert to == "yuki@softtrack.dev"
    assert "declined your request to join Engineering" in body
    # Declined, they may ask again.
    assert ask(client, eng["yuki"], eng["id"]).status_code == 200


def test_an_admin_of_another_team_decides_nothing_here(client, eng, auth):
    request = ask(client, eng["yuki"], eng["id"]).json()
    lena = auth(email="lena@softtrack.dev", full_name="Lena Fischer")
    other = client.post(
        "/teams", json={"name": "Design", "key": "DES"}, headers=lena["headers"]
    ).json()
    # Through their own team's URL, the request is not found ...
    response = client.post(
        f"/teams/{other['id']}/join-requests/{request['id']}/approve",
        json={"role": "admin"},
        headers=lena["headers"],
    )
    assert response.status_code == 404
    assert response.json()["code"] == "join_request_not_found"
    # ... and through Engineering's, they are not on it.
    response = client.post(
        f"/teams/{eng['id']}/join-requests/{request['id']}/approve",
        json={"role": "admin"},
        headers=lena["headers"],
    )
    assert response.status_code == 403


def test_somebody_made_external_after_asking_joins_only_as_a_guest(
    client, eng, session
):
    request = ask(client, eng["yuki"], eng["id"]).json()
    yuki = session.get(User, eng["yuki"]["user"]["id"])
    yuki.is_external = True
    session.add(yuki)
    session.commit()

    response = client.post(
        f"/teams/{eng['id']}/join-requests/{request['id']}/approve",
        json={"role": "member"},
        headers=eng["admin"]["headers"],
    )
    assert response.status_code == 400
    assert response.json()["code"] == "external_account_is_guest"


def test_adding_somebody_by_hand_settles_their_request(client, eng):
    ask(client, eng["yuki"], eng["id"])
    client.post(
        f"/teams/{eng['id']}/members",
        json={"email": "yuki@softtrack.dev"},
        headers=eng["admin"]["headers"],
    )
    assert requests_of(client, eng["admin"], eng["id"]) == []


# --- an open team ------------------------------------------------------------


def test_anybody_joins_an_open_team_as_a_member(client, eng, session):
    response = client.post(f"/teams/{eng['id']}/join", headers=eng["yuki"]["headers"])
    assert response.status_code == 400
    assert response.json()["code"] == "team_not_open"

    patch_team(client, eng["admin"], eng["id"], open_to_join=True)
    assert directory(client, eng["yuki"])["teams"][0]["open_to_join"] is True
    response = client.post(f"/teams/{eng['id']}/join", headers=eng["yuki"]["headers"])
    assert response.status_code == 200, response.text
    assert response.json()["key"] == "ENG"
    assert roles(session, eng["id"])[eng["yuki"]["user"]["id"]] == "member"

    again = client.post(f"/teams/{eng['id']}/join", headers=eng["yuki"]["headers"])
    assert again.status_code == 400
    assert again.json()["code"] == "already_member"


# --- from outside the organisation -------------------------------------------


def test_an_account_from_outside_neither_asks_nor_joins(client, eng, session):
    patch_team(client, eng["admin"], eng["id"], open_to_join=True)
    request = ask(client, eng["yuki"], eng["id"]).json()
    yuki = session.get(User, eng["yuki"]["user"]["id"])
    yuki.is_external = True
    session.add(yuki)
    session.commit()

    for response in (
        ask(client, eng["yuki"], eng["id"]),
        client.post(f"/teams/{eng['id']}/join", headers=eng["yuki"]["headers"]),
        client.delete(
            f"/teams/join-requests/{request['id']}", headers=eng["yuki"]["headers"]
        ),
        client.get("/teams/directory", headers=eng["yuki"]["headers"]),
    ):
        assert response.status_code == 403
        assert response.json()["code"] == "external_account"


# --- a team deleted --------------------------------------------------------------


def test_deleting_a_team_takes_its_requests_with_it(client, eng, session):
    request = ask(client, eng["yuki"], eng["id"]).json()
    # Demo, the first account, is the site admin; the team has no tickets.
    response = client.delete(
        f"/admin/teams/{eng['id']}", headers=eng["admin"]["headers"]
    )
    assert response.status_code == 204, response.text
    assert session.get(TeamJoinRequest, request["id"]) is None

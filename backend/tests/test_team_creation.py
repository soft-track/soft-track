"""Who may create teams, and asking for one (#306).

A team takes a key, and a key is never given back. An instance setting says
who may create a team: anyone (the default, and what it always was), site
admins only, or named people; TEAM_CREATION in the environment wins over it.
An account from outside the organisation never may. Anybody else can ask,
and approving creates the team with them as its admin.
"""

import pytest

from app_softtrack import team_creation as admin_routes
from app_softtrack import teams as team_routes
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
    monkeypatch.setattr(admin_routes, "get_mailer", lambda: fake)
    return fake


@pytest.fixture
def people(auth):
    """Demo, the first account and so the site admin; Amina and Tomas."""
    return {
        "admin": auth(),
        "amina": auth(email="amina@softtrack.dev", full_name="Amina Khan"),
        "tomas": auth(email="tomas@softtrack.dev", full_name="Tomas Silva"),
    }


def set_policy(client, admin, policy, named=()):
    response = client.put(
        "/admin/team-creation",
        json={"policy": policy, "named_people_ids": [p["user"]["id"] for p in named]},
        headers=admin["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def create(client, actor, key="BRD", name="Brand studio"):
    return client.post(
        "/teams", json={"name": name, "key": key}, headers=actor["headers"]
    )


def ask(client, actor, key="BRD", name="Brand studio", reason="The rebrand"):
    return client.post(
        "/teams/requests",
        json={"name": name, "key": key, "reason": reason},
        headers=actor["headers"],
    )


def access(client, actor):
    response = client.get("/teams/creation", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()


# --- the setting ---------------------------------------------------------------


def test_anyone_is_the_default(client, people):
    settings_ = client.get("/admin/team-creation", headers=people["admin"]["headers"])
    assert settings_.json()["policy"] == "anyone"
    assert settings_.json()["from_environment"] is False
    assert access(client, people["tomas"])["may_create"] is True
    assert create(client, people["tomas"]).status_code == 200


def test_site_admins_only_refuses_everybody_else_with_a_code(client, people):
    set_policy(client, people["admin"], "site_admins")

    response = create(client, people["tomas"])
    assert response.status_code == 403
    assert response.json()["code"] == "team_creation_restricted"
    assert create(client, people["admin"], key="ENG").status_code == 200

    tomas = access(client, people["tomas"])
    assert tomas["may_create"] is False
    assert tomas["policy"] == "site_admins"
    # Who to ask: the site admins.
    assert [a["full_name"] for a in tomas["site_admins"]] == ["Demo User"]


def test_named_people_and_the_site_admins_may(client, people):
    set_policy(client, people["admin"], "named_people", named=[people["amina"]])

    assert create(client, people["amina"], key="AMI").status_code == 200
    assert create(client, people["admin"], key="ENG").status_code == 200
    refused = create(client, people["tomas"])
    assert refused.status_code == 403
    assert refused.json()["code"] == "team_creation_restricted"


def test_the_named_list_is_kept_when_the_policy_changes(client, people):
    set_policy(client, people["admin"], "named_people", named=[people["amina"]])
    body = set_policy(client, people["admin"], "site_admins", named=[people["amina"]])
    assert [p["full_name"] for p in body["named_people"]] == ["Amina Khan"]
    assert create(client, people["amina"], key="AMI").status_code == 403


def test_only_a_site_admin_reads_or_changes_the_setting(client, people):
    tomas = people["tomas"]["headers"]
    assert client.get("/admin/team-creation", headers=tomas).status_code == 403
    response = client.put(
        "/admin/team-creation", json={"policy": "anyone"}, headers=tomas
    )
    assert response.status_code == 403
    assert response.json()["code"] == "not_site_admin"


def test_the_environment_wins(client, people, monkeypatch):
    monkeypatch.setattr(settings, "team_creation", "site_admins")

    body = client.get("/admin/team-creation", headers=people["admin"]["headers"]).json()
    assert body["policy"] == "site_admins"
    assert body["from_environment"] is True
    assert create(client, people["tomas"]).status_code == 403

    response = client.put(
        "/admin/team-creation",
        json={"policy": "anyone"},
        headers=people["admin"]["headers"],
    )
    assert response.status_code == 409
    assert response.json()["code"] == "team_creation_from_environment"
    # The named people are still the app's to choose.
    set_policy(client, people["admin"], "site_admins", named=[people["amina"]])


def test_an_unknown_person_cannot_be_named(client, people):
    response = client.put(
        "/admin/team-creation",
        json={"policy": "named_people", "named_people_ids": [999]},
        headers=people["admin"]["headers"],
    )
    assert response.status_code == 404
    assert response.json()["code"] == "user_not_found"


# --- accounts from outside -----------------------------------------------------


@pytest.fixture
def outsider(client, people):
    admin = people["admin"]
    team = create(client, admin, key="ENG", name="Engineering").json()
    invite = client.post(
        f"/teams/{team['id']}/invites",
        json={"email": "carlos@acme-retail.com", "role": "guest", "external": True},
        headers=admin["headers"],
    )
    body = client.post(
        "/auth/register",
        json={
            "email": "carlos@acme-retail.com",
            "password": "password123",
            "full_name": "Carlos Rivera",
            "invite_token": invite.json()["token"],
        },
    ).json()
    return {
        "user": body["user"],
        "headers": {"Authorization": f"Bearer {body['access_token']}"},
    }


def test_an_account_from_outside_never_creates_or_asks(client, people, outsider):
    # Whatever the setting: anyone is the default.
    assert create(client, outsider).json()["code"] == "external_account"
    assert ask(client, outsider).json()["code"] == "external_account"
    assert access(client, outsider) == {
        "may_create": False,
        "policy": "anyone",
        "site_admins": [],
        "pending_requests": [],
    }


def test_an_account_from_outside_cannot_be_named(client, people, outsider):
    response = client.put(
        "/admin/team-creation",
        json={"policy": "named_people", "named_people_ids": [outsider["user"]["id"]]},
        headers=people["admin"]["headers"],
    )
    assert response.status_code == 400
    assert response.json()["code"] == "external_account"


# --- asking for a team ---------------------------------------------------------


def test_asking_tells_the_site_admins_and_waits(client, people, mailer):
    set_policy(client, people["admin"], "site_admins")

    response = ask(client, people["tomas"], key="brd")
    assert response.status_code == 200, response.text
    request = response.json()
    assert (request["name"], request["key"], request["state"]) == (
        "Brand studio",
        "BRD",
        "pending",
    )
    assert request["requester"]["full_name"] == "Tomas Silva"

    (mail,) = mailer.sent
    assert mail[0] == "demo@softtrack.dev"
    assert "Tomas Silva" in mail[1]
    assert "Brand studio · BRD" in mail[2] and "The rebrand" in mail[2]

    assert [r["key"] for r in access(client, people["tomas"])["pending_requests"]] == [
        "BRD"
    ]
    waiting = client.get(
        "/admin/team-creation", headers=people["admin"]["headers"]
    ).json()["requests"]
    assert [(r["key"], r["reason"]) for r in waiting] == [("BRD", "The rebrand")]


def test_approving_creates_the_team_with_the_person_who_asked_as_admin(
    client, people, mailer
):
    set_policy(client, people["admin"], "site_admins")
    request = ask(client, people["tomas"]).json()

    response = client.post(
        f"/admin/team-requests/{request['id']}/approve",
        headers=people["admin"]["headers"],
    )
    assert response.status_code == 200, response.text
    team = response.json()
    assert (team["name"], team["key"]) == ("Brand studio", "BRD")

    members = client.get(
        f"/teams/{team['id']}/members", headers=people["tomas"]["headers"]
    ).json()
    assert [(m["user"]["full_name"], m["role"]) for m in members] == [
        ("Tomas Silva", "admin")
    ]
    # Not the site admin who approved it.
    assert (
        client.get(
            f"/teams/{team['id']}", headers=people["admin"]["headers"]
        ).status_code
        == 403
    )
    assert mailer.sent[-1][0] == "tomas@softtrack.dev"
    assert access(client, people["tomas"])["pending_requests"] == []

    again = client.post(
        f"/admin/team-requests/{request['id']}/approve",
        headers=people["admin"]["headers"],
    )
    assert again.status_code == 409
    assert again.json()["code"] == "team_request_decided"


def test_declining_tells_them_why(client, people, mailer):
    request = ask(client, people["tomas"]).json()
    response = client.post(
        f"/admin/team-requests/{request['id']}/decline",
        json={"reason": "Use the Marketing team."},
        headers=people["admin"]["headers"],
    )
    assert response.status_code == 200, response.text
    assert response.json()["state"] == "declined"
    assert mailer.sent[-1][0] == "tomas@softtrack.dev"
    assert "Use the Marketing team." in mailer.sent[-1][2]
    assert create(client, people["admin"], key="BRD").status_code == 200


def test_a_key_in_use_or_asked_for_cannot_be_asked_for(client, people):
    create(client, people["admin"], key="ENG")
    assert ask(client, people["tomas"], key="ENG").json()["code"] == "team_key_taken"
    assert ask(client, people["tomas"]).status_code == 200
    assert ask(client, people["amina"]).json()["code"] == "team_key_taken"


def test_only_a_site_admin_decides(client, people):
    request = ask(client, people["tomas"]).json()
    for action in ("approve", "decline"):
        response = client.post(
            f"/admin/team-requests/{request['id']}/{action}",
            json={},
            headers=people["amina"]["headers"],
        )
        assert response.status_code == 403
        assert response.json()["code"] == "not_site_admin"


def test_an_unknown_request(client, people):
    response = client.post(
        "/admin/team-requests/999/approve", headers=people["admin"]["headers"]
    )
    assert response.status_code == 404
    assert response.json()["code"] == "team_request_not_found"

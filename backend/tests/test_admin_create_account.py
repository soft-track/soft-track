"""A site admin creates an account for somebody (#303).

The account has no password; its owner chooses one from a single-use link,
emailed where SMTP is configured and copied by the admin where it is not. It
can be assigned work and mentioned before anybody has signed into it.
"""

import re

import pytest
from sqlmodel import select

import app_identity.admin as admin_routes
from lib_softtrack.tables import Notification, PasswordReset, User
from web import settings


class FakeMailer:
    def __init__(self):
        self.sent: list[tuple[str, str, str]] = []

    def send(self, to: str, subject: str, body: str) -> None:
        self.sent.append((to, subject, body))


@pytest.fixture
def mailer(monkeypatch):
    """An instance with SMTP configured, whose mail is captured."""
    fake = FakeMailer()
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(admin_routes, "get_mailer", lambda: fake)
    return fake


def create(client, actor, **fields):
    body = {"full_name": "Yuki Sato", "email": "yuki@example.com", **fields}
    return client.post("/admin/users", json=body, headers=actor["headers"])


def token_of(link: str) -> str:
    return re.search(r"/welcome/([\w-]+)$", link).group(1)


def choose(client, token, password="chosen-password"):
    return client.post(
        "/auth/reset-password", json={"token": token, "new_password": password}
    )


def login(client, email, password):
    return client.post("/auth/login", data={"username": email, "password": password})


def test_only_a_site_admin_can_create_one(client, auth):
    auth(email="admin@example.com")
    someone = auth(email="someone@example.com")
    response = create(client, someone)
    assert response.status_code == 403
    assert response.json()["code"] == "not_site_admin"


def test_the_account_is_prepared_with_where_they_belong(client, team, auth, session):
    manager = auth(email="nina@example.com", full_name="Nina Petrova")
    department = client.post(
        "/departments", json={"name": "Support"}, headers=team["headers"]
    ).json()

    response = create(
        client,
        team,
        username="yuki",
        job_title="Support Specialist",
        started_on="2026-10-05",
        department_id=department["id"],
        manager_id=manager["user"]["id"],
        teams=[{"team_id": team["team"]["id"], "role": "member"}],
    )

    assert response.status_code == 201, response.text
    body = response.json()
    user = body["user"]
    assert user["username"] == "yuki"
    assert user["job_title"] == "Support Specialist"
    assert user["started_on"] == "2026-10-05"
    assert user["department"]["name"] == "Support"
    assert user["manager"]["full_name"] == "Nina Petrova"
    assert user["team_count"] == 1
    assert user["is_activated"] is False
    assert user["has_password"] is False
    assert user["last_login_at"] is None
    assert body["link"].startswith(f"{settings.app_base_url}/welcome/")
    assert body["welcome_link"]["emailed_at"] is None

    members = client.get(
        f"/teams/{team['team']['id']}/members", headers=team["headers"]
    ).json()
    yuki = next(m for m in members if m["user"]["username"] == "yuki")
    assert yuki["role"] == "member"
    assert yuki["user"]["is_activated"] is False


def test_only_the_hash_of_the_link_is_stored(client, auth, session):
    admin = auth(email="admin@example.com")
    link = create(client, admin).json()["link"]
    (row,) = session.exec(select(PasswordReset)).all()
    assert token_of(link) not in row.token_hash
    assert len(row.token_hash) == 64


def test_the_link_lives_as_long_as_an_invitation(client, auth):
    admin = auth(email="admin@example.com")
    body = create(client, admin).json()["welcome_link"]
    from datetime import datetime

    made = datetime.fromisoformat(body["created_at"])
    ends = datetime.fromisoformat(body["expires_at"])
    assert (ends - made).days == settings.invite_expire_days


def test_its_owner_chooses_a_password_and_activates_it(client, auth):
    admin = auth(email="admin@example.com")
    created = create(client, admin).json()

    # Nothing to sign in with before the link is used.
    assert login(client, "yuki@example.com", "chosen-password").status_code == 401

    assert choose(client, token_of(created["link"])).status_code == 204
    assert login(client, "yuki@example.com", "chosen-password").status_code == 200

    row = client.get("/admin/users?q=yuki", headers=admin["headers"]).json()
    (yuki,) = row["items"]
    assert yuki["is_activated"] is True
    assert yuki["welcome_link"] is None

    # It works once.
    assert choose(client, token_of(created["link"])).status_code == 400


def test_with_smtp_the_link_is_emailed(client, auth, mailer):
    admin = auth(email="admin@example.com", full_name="Sofia Admin")
    body = create(client, admin, username="yuki", send_email=True).json()

    [(to, subject, text)] = mailer.sent
    assert to == "yuki@example.com"
    assert subject == "Your SoftTrack account is ready"
    assert body["link"] in text
    assert "Sofia Admin made an account for you" in text
    assert body["welcome_link"]["emailed_at"] is not None


def test_without_smtp_asking_to_email_it_is_refused(client, auth, session):
    admin = auth(email="admin@example.com")
    response = create(client, admin, send_email=True)
    assert response.status_code == 400
    assert response.json()["code"] == "email_not_configured"
    # And nothing was half-made.
    assert (
        session.exec(select(User).where(User.email == "yuki@example.com")).first()
        is None
    )


def test_sending_the_link_again_retires_the_old_one(client, auth, mailer):
    admin = auth(email="admin@example.com")
    created = create(client, admin).json()
    user_id = created["user"]["id"]

    again = client.post(
        f"/admin/users/{user_id}/welcome-link",
        json={"send_email": True},
        headers=admin["headers"],
    )
    assert again.status_code == 200, again.text
    assert len(mailer.sent) == 1

    assert choose(client, token_of(created["link"])).status_code == 400
    assert choose(client, token_of(again.json()["link"])).status_code == 204


def test_no_new_link_for_an_account_already_activated(client, auth):
    admin = auth(email="admin@example.com")
    ada = auth(email="ada@example.com")
    response = client.post(
        f"/admin/users/{ada['user']['id']}/welcome-link",
        json={},
        headers=admin["headers"],
    )
    assert response.status_code == 409
    assert response.json()["code"] == "account_already_activated"


def test_an_admin_cannot_set_its_first_password(client, auth):
    """The owner chooses it. Nobody tells them what it is."""
    admin = auth(email="admin@example.com")
    user_id = create(client, admin).json()["user"]["id"]
    response = client.post(
        f"/admin/users/{user_id}/reset-password",
        json={"new_password": "admin-chose-this"},
        headers=admin["headers"],
    )
    assert response.status_code == 409
    assert response.json()["code"] == "account_not_activated"


def test_it_works_with_registration_closed(client, auth, monkeypatch):
    admin = auth(email="admin@example.com")
    monkeypatch.setattr(settings, "open_registration", False)
    assert create(client, admin).status_code == 201


def test_it_is_not_counted_by_the_registration_rate_limit(client, auth):
    """Twelve accounts from one machine: the eleventh registration would be
    refused. Created by a signed-in admin, none of them counts."""
    admin = auth(email="admin@example.com")
    for i in range(12):
        response = create(
            client, admin, full_name=f"Hire {i}", email=f"hire{i}@example.com"
        )
        assert response.status_code == 201, response.text
    # The registration budget of this address is as it was: one spent.
    assert auth(email="stranger@example.com")["user"]["email"] == "stranger@example.com"


def test_a_taken_address_or_username_is_refused(client, auth):
    admin = auth(email="admin@example.com")
    auth(email="ada@example.com")
    taken = create(client, admin, email="Ada@Example.com")
    assert taken.status_code == 400
    assert taken.json()["code"] == "email_taken"
    handle = create(client, admin, username=admin["user"]["username"])
    assert handle.status_code == 400
    assert handle.json()["code"] == "username_taken"


def test_a_missing_team_leaves_nothing_behind(client, auth, session):
    admin = auth(email="admin@example.com")
    response = create(client, admin, teams=[{"team_id": 999, "role": "member"}])
    assert response.status_code == 404
    assert (
        session.exec(select(User).where(User.email == "yuki@example.com")).first()
        is None
    )


def test_the_directory_filters_and_describes_accounts_not_yet_activated(client, auth):
    admin = auth(email="admin@example.com")
    auth(email="ada@example.com")
    create(client, admin)

    page = client.get(
        "/admin/users?role=not_activated", headers=admin["headers"]
    ).json()
    assert page["total"] == 1
    (yuki,) = page["items"]
    assert yuki["email"] == "yuki@example.com"
    assert yuki["welcome_link"]["expires_at"]

    people = client.get("/users", headers=admin["headers"]).json()["items"]
    assert {p["username"]: p["is_activated"] for p in people}["yuki"] is False


def test_it_can_be_assigned_work_and_mentioned_before_signing_in(client, team, session):
    created = create(
        client,
        team,
        username="yuki",
        teams=[{"team_id": team["team"]["id"], "role": "member"}],
    ).json()
    yuki_id = created["user"]["id"]

    ticket = client.post(
        f"/teams/{team['team']['id']}/tickets",
        json={"title": "Welcome pack", "assignee_id": yuki_id},
        headers=team["headers"],
    )
    assert ticket.status_code == 200, ticket.text
    assert ticket.json()["assignee"]["id"] == yuki_id
    assert ticket.json()["assignee"]["is_activated"] is False

    comment = client.post(
        f"/tickets/{ticket.json()['id']}/comments",
        json={"body": "@yuki this one is yours when you arrive"},
        headers=team["headers"],
    )
    assert comment.status_code in (200, 201), comment.text
    kinds = session.exec(
        select(Notification.kind).where(Notification.user_id == yuki_id)
    ).all()
    assert "mentioned" in kinds

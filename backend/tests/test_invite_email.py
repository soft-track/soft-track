"""Emailing an invitation as well as handing back its link (issue #84).

The copy-a-link flow is the baseline every instance has; these pin that
email is purely an addition to it -- off unless asked for, refused where it
cannot happen, and honest about which link was sent.
"""

import pytest

import app_softtrack.invites as invite_routes
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
    monkeypatch.setattr(invite_routes, "get_mailer", lambda: fake)
    return fake


def invite(client, team, email="new@example.com", expect=200, **fields):
    response = client.post(
        f"/teams/{team['team']['id']}/invites",
        json={"email": email, **fields},
        headers=team["headers"],
    )
    assert response.status_code == expect, response.text
    return response.json()


def listed(client, team):
    response = client.get(
        f"/teams/{team['team']['id']}/invites", headers=team["headers"]
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_an_invite_is_not_emailed_unless_asked(client, team, mailer):
    """The existing flow, unchanged, even where mail could be sent."""
    created = invite(client, team)
    assert created["token"]
    assert created["emailed_at"] is None
    assert mailer.sent == []


def test_asking_emails_the_link_to_the_invited_address(client, team, mailer):
    created = invite(client, team, email="New@Example.com", send_email=True)

    [(to, subject, body)] = mailer.sent
    assert to == "new@example.com"
    assert subject == "Demo User invited you to Engineering on SoftTrack"
    # The same link the response hands back for copying.
    assert f"{settings.app_base_url}/invite/{created['token']}" in body
    assert "demo@softtrack.dev" in body
    assert "as a member" in body
    assert "The link works until" in body
    assert created["emailed_at"] is not None


def test_an_admin_invite_says_so(client, team, mailer):
    invite(client, team, role="admin", send_email=True)
    assert "as an admin" in mailer.sent[0][2]


def test_the_pending_list_shows_which_were_emailed(client, team, mailer):
    invite(client, team, email="emailed@example.com", send_email=True)
    invite(client, team, email="copied@example.com")
    by_address = {i["email"]: i["emailed_at"] for i in listed(client, team)}
    assert by_address["emailed@example.com"] is not None
    assert by_address["copied@example.com"] is None


def test_without_smtp_asking_to_email_is_refused_and_nothing_is_created(
    client, team, monkeypatch
):
    fake = FakeMailer()
    monkeypatch.setattr(invite_routes, "get_mailer", lambda: fake)
    response = client.post(
        f"/teams/{team['team']['id']}/invites",
        json={"email": "new@example.com", "send_email": True},
        headers=team["headers"],
    )
    assert response.status_code == 400
    assert "cannot send email" in response.json()["detail"]
    assert listed(client, team) == []
    assert fake.sent == []


def test_resending_emails_the_new_link_and_kills_the_old_one(client, team, mailer):
    first = invite(client, team, send_email=True)
    second = invite(client, team, send_email=True)

    assert second["token"] != first["token"]
    assert second["token"] in mailer.sent[1][2]
    assert client.get(f"/invites/{first['token']}").status_code == 404
    assert client.get(f"/invites/{second['token']}").status_code == 200


def test_a_resend_by_link_forgets_the_earlier_email(client, team, mailer):
    """The emailed link stopped working when the new one was minted, so
    "emailed" would now describe a dead link."""
    invite(client, team, send_email=True)
    refreshed = invite(client, team)
    assert refreshed["emailed_at"] is None
    assert len(mailer.sent) == 1

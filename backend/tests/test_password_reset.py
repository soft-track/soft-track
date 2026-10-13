"""Resetting a forgotten password by email (issue #83).

Most of these are about what the flow must *not* do: say whether an address
has an account, send mail from an instance with nowhere to send it, accept a
link twice, or outlive a password change made some other way.
"""

import re
from datetime import timedelta

import pytest
from sqlmodel import select

import app_identity.identity as identity_routes
from lib_softtrack.tables import PasswordReset, User, utcnow
from web import settings


class FakeMailer:
    """Records instead of sending."""

    def __init__(self):
        self.sent: list[tuple[str, str, str]] = []

    def send(self, to: str, subject: str, body: str) -> None:
        self.sent.append((to, subject, body))


@pytest.fixture
def mailer(monkeypatch):
    """An instance with SMTP configured, whose mail is captured."""
    fake = FakeMailer()
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(identity_routes, "get_mailer", lambda: fake)
    return fake


def forgot(client, email):
    return client.post("/auth/forgot-password", json={"email": email})


def link_token(mail) -> str:
    _, _, body = mail
    return re.search(r"/reset-password\?token=([\w-]+)", body).group(1)


def reset(client, token, password="brand-new-password"):
    return client.post(
        "/auth/reset-password", json={"token": token, "new_password": password}
    )


def login(client, email, password):
    return client.post("/auth/login", data={"username": email, "password": password})


# --- asking for a link -------------------------------------------------------


def test_a_known_address_gets_one_link_by_email(client, auth, mailer):
    auth(email="sam@example.com", full_name="Sam")
    response = forgot(client, "Sam@Example.com")

    assert response.status_code == 204
    [(to, subject, body)] = mailer.sent
    assert to == "sam@example.com"
    assert "Reset your SoftTrack password" == subject
    assert f"{settings.app_base_url}/reset-password?token=" in body
    assert "60 minutes" in body


def test_an_unknown_address_gets_the_same_answer_and_no_mail(client, mailer):
    """204 either way: the response must not say which addresses exist."""
    response = forgot(client, "nobody@example.com")
    assert response.status_code == 204
    assert response.content == b""
    assert mailer.sent == []


def test_a_deactivated_account_is_sent_nothing(client, auth, mailer, session):
    user = auth(email="gone@example.com")["user"]
    row = session.get(User, user["id"])
    row.is_active = False
    session.add(row)
    session.commit()

    assert forgot(client, "gone@example.com").status_code == 204
    assert mailer.sent == []


def test_without_smtp_nothing_is_sent_and_the_link_is_not_offered(
    client, auth, monkeypatch
):
    fake = FakeMailer()
    monkeypatch.setattr(identity_routes, "get_mailer", lambda: fake)
    auth(email="sam@example.com")

    assert client.get("/auth/config").json()["password_reset"] is False
    assert forgot(client, "sam@example.com").status_code == 204
    assert fake.sent == []


def test_the_config_offers_the_link_when_mail_can_be_sent(client, mailer):
    assert client.get("/auth/config").json()["password_reset"] is True


def test_only_a_hash_of_the_token_is_stored(client, auth, mailer, session):
    auth(email="sam@example.com")
    forgot(client, "sam@example.com")
    token = link_token(mailer.sent[0])

    [row] = session.exec(select(PasswordReset)).all()
    assert token not in row.token_hash
    assert len(row.token_hash) == 64


def test_asking_again_replaces_the_previous_link(client, auth, mailer):
    auth(email="sam@example.com")
    forgot(client, "sam@example.com")
    forgot(client, "sam@example.com")
    first, second = (link_token(mail) for mail in mailer.sent)

    assert reset(client, first).status_code == 400
    assert reset(client, second).status_code == 204


def test_one_inbox_cannot_be_flooded(client, auth, mailer):
    auth(email="sam@example.com")
    statuses = [forgot(client, "sam@example.com").status_code for _ in range(4)]
    assert statuses == [204, 204, 204, 429]
    assert len(mailer.sent) == 3


def test_the_limit_is_keyed_on_the_address_typed_not_the_account(client, mailer):
    """An unknown address runs out just the same, so a 429 reveals nothing."""
    statuses = [forgot(client, "nobody@example.com").status_code for _ in range(4)]
    assert statuses == [204, 204, 204, 429]


# --- using the link ----------------------------------------------------------


def test_a_link_sets_the_new_password_and_signs_everyone_out(client, auth, mailer):
    user = auth(email="sam@example.com")
    forgot(client, "sam@example.com")

    assert reset(client, link_token(mailer.sent[0])).status_code == 204

    # The session from before the reset is over.
    assert client.get("/auth/me", headers=user["headers"]).status_code == 401
    assert login(client, "sam@example.com", "password123").status_code == 401
    assert login(client, "sam@example.com", "brand-new-password").status_code == 200


def test_a_link_works_once(client, auth, mailer):
    auth(email="sam@example.com")
    forgot(client, "sam@example.com")
    token = link_token(mailer.sent[0])

    assert reset(client, token).status_code == 204
    again = reset(client, token, "a-third-password")
    assert again.status_code == 400
    assert login(client, "sam@example.com", "a-third-password").status_code == 401


def test_an_expired_link_is_refused(client, auth, mailer, session):
    auth(email="sam@example.com")
    forgot(client, "sam@example.com")
    row = session.exec(select(PasswordReset)).one()
    row.expires_at = utcnow() - timedelta(seconds=1)
    session.add(row)
    session.commit()

    response = reset(client, link_token(mailer.sent[0]))
    assert response.status_code == 400
    assert login(client, "sam@example.com", "password123").status_code == 200


def test_a_password_change_since_the_request_kills_the_link(client, auth, mailer):
    """The owner changed it another way; an old link in the inbox must not
    undo that."""
    user = auth(email="sam@example.com")
    forgot(client, "sam@example.com")
    changed = client.post(
        "/auth/me/password",
        json={"current_password": "password123", "new_password": "changed-by-owner"},
        headers=user["headers"],
    )
    assert changed.status_code == 200

    assert reset(client, link_token(mailer.sent[0])).status_code == 400
    assert login(client, "sam@example.com", "changed-by-owner").status_code == 200


def test_a_made_up_token_gets_the_same_answer_as_an_expired_one(client, mailer):
    response = reset(client, "not-a-real-token")
    assert response.status_code == 400
    assert response.json()["detail"].startswith("This reset link is invalid")


def test_the_new_password_has_the_usual_minimum_length(client, auth, mailer):
    auth(email="sam@example.com")
    forgot(client, "sam@example.com")
    assert reset(client, link_token(mailer.sent[0]), "short").status_code == 422

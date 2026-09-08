"""The SMTP transport, without a mail server.

`send_pending_digests` is covered against a fake in test_digest.py, so what is
left here is the one piece nothing else exercises: the conversation with the
server, where the cost of being wrong is a deployment that looks configured
and silently sends nothing.
"""

import smtplib

import pytest

from lib_utils.mailer import NullMailer, SMTPMailer, get_mailer


class FakeSMTP:
    """Records the calls a real smtplib.SMTP would receive."""

    instances: list["FakeSMTP"] = []

    def __init__(self, host, port, timeout=None):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.calls: list[str] = []
        self.messages = []
        self.logins = []
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.calls.append("quit")
        return False

    def starttls(self):
        self.calls.append("starttls")

    def login(self, username, password):
        self.calls.append("login")
        self.logins.append((username, password))

    def send_message(self, message):
        self.calls.append("send")
        self.messages.append(message)


@pytest.fixture
def fake_smtp(monkeypatch):
    FakeSMTP.instances = []
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    return FakeSMTP


def test_the_message_carries_the_configured_sender(fake_smtp):
    SMTPMailer("mail.example.com", 587, sender="softtrack@example.com").send(
        "sam@example.com", "Two things happened", "the body"
    )

    (server,) = fake_smtp.instances
    assert (server.host, server.port) == ("mail.example.com", 587)
    (message,) = server.messages
    assert message["From"] == "softtrack@example.com"
    assert message["To"] == "sam@example.com"
    assert message["Subject"] == "Two things happened"
    assert message.get_content().strip() == "the body"


def test_tls_is_negotiated_before_the_credentials_go_over_the_wire(fake_smtp):
    """Ordering is the whole point: a login before STARTTLS is a password in
    the clear, and it would still deliver the mail."""
    SMTPMailer(
        "mail.example.com", 587, username="bot", password="hunter2", use_tls=True
    ).send("sam@example.com", "s", "b")

    (server,) = fake_smtp.instances
    assert server.calls == ["starttls", "login", "send", "quit"]
    assert server.logins == [("bot", "hunter2")]


def test_an_unauthenticated_relay_skips_the_login(fake_smtp):
    SMTPMailer("localhost", 25, use_tls=False).send("sam@example.com", "s", "b")

    (server,) = fake_smtp.instances
    assert server.calls == ["send", "quit"]


def test_without_an_smtp_host_nothing_is_sent(monkeypatch):
    """An instance that never configured mail gets the inbox and no errors."""
    from web import settings

    monkeypatch.setattr(settings, "smtp_host", "")
    assert isinstance(get_mailer(), NullMailer)
    # It has to be safe to call, because the digest does not check first.
    get_mailer().send("sam@example.com", "s", "b")


def test_configuring_a_host_switches_the_transport(monkeypatch):
    from web import settings

    monkeypatch.setattr(settings, "smtp_host", "mail.example.com")
    monkeypatch.setattr(settings, "email_from", "bot@example.com")

    mailer = get_mailer()
    assert isinstance(mailer, SMTPMailer)
    assert mailer.host == "mail.example.com"
    assert mailer.sender == "bot@example.com"

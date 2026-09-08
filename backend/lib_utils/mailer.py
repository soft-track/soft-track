"""Sending mail, and the seam that keeps the tests off the network.

`Mailer` is the whole interface the rest of the app sees: one method, given a
recipient and a rendered message. Two implementations ship -- one that talks
SMTP and one that does nothing -- and `get_mailer()` picks between them from
the settings, so no caller has to check whether mail is configured.
"""

import logging
import smtplib
from email.message import EmailMessage
from typing import Protocol

logger = logging.getLogger(__name__)


class Mailer(Protocol):
    def send(self, to: str, subject: str, body: str) -> None: ...


class NullMailer:
    """Swallows everything. What an instance with no SMTP host gets.

    Not an error: email is the optional half of notifications, and the inbox
    works without it. The debug line is there so a misconfigured instance can
    be diagnosed from the log rather than from a mail that never arrived.
    """

    def send(self, to: str, subject: str, body: str) -> None:
        logger.debug("Email not configured; dropping %r to %s", subject, to)


class SMTPMailer:
    def __init__(
        self,
        host: str,
        port: int,
        username: str = "",
        password: str = "",
        use_tls: bool = True,
        sender: str = "softtrack@localhost",
        timeout: int = 30,
    ):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.use_tls = use_tls
        self.sender = sender
        self.timeout = timeout

    def send(self, to: str, subject: str, body: str) -> None:
        message = EmailMessage()
        message["From"] = self.sender
        message["To"] = to
        message["Subject"] = subject
        message.set_content(body)

        with smtplib.SMTP(self.host, self.port, timeout=self.timeout) as server:
            if self.use_tls:
                server.starttls()
            if self.username:
                server.login(self.username, self.password)
            server.send_message(message)


def get_mailer() -> Mailer:
    from web import settings

    if not settings.email_delivery_configured:
        return NullMailer()
    return SMTPMailer(
        host=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_username,
        password=settings.smtp_password,
        use_tls=settings.smtp_use_tls,
        sender=settings.email_from,
    )

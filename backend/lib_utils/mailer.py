"""Sending mail, and the seam that keeps the tests off the network.

`Mailer` is the whole interface the rest of the app sees: one method, given a
recipient and a rendered message. Two implementations ship -- one that talks
SMTP and one that does nothing -- and `get_mailer()` picks between them from
the settings, so no caller has to check whether mail is configured.

The SMTP one also says how each attempt went (#312), so Administration ->
Usage can count what went out and show what the server said last. It says
how many addresses a message was for, and never which.
"""

import logging
import re
import smtplib
from email.message import EmailMessage
from email.utils import getaddresses
from typing import Callable, Optional, Protocol

logger = logging.getLogger(__name__)

#: How much of what a server said is kept.
ERROR_CHARS = 500

#: An address, with the angle brackets a server often puts round it. A server
#: refusing a message tends to name the address it refused.
_ADDRESS = re.compile(r"<?[^\s<>@,;:\"'()]+@[\w.-]*\w>?")

#: Told of each attempt: what went wrong, or None when the server took the
#: message, and how many addresses it was for.
Record = Callable[[Optional[str], int], None]


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
        record: Optional[Record] = None,
    ):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.use_tls = use_tls
        self.sender = sender
        self.timeout = timeout
        self.record = record

    def send(self, to: str, subject: str, body: str) -> None:
        message = EmailMessage()
        message["From"] = self.sender
        message["To"] = to
        message["Subject"] = subject
        message.set_content(body)

        try:
            with smtplib.SMTP(self.host, self.port, timeout=self.timeout) as server:
                if self.use_tls:
                    server.starttls()
                if self.username:
                    server.login(self.username, self.password)
                server.send_message(message)
        except Exception as exc:
            self._record(exc, to)
            raise
        self._record(None, to)

    def _record(self, failure: Optional[Exception], to: str) -> None:
        if self.record is None:
            return
        # Writing it down is a side note to the send. A database that is down
        # must not turn a message the server took into one the caller thinks
        # failed, or hide the server's own error behind its.
        try:
            error = server_said(failure) if failure is not None else None
            self.record(error, max(len(getaddresses([to])), 1))
        except Exception:
            logger.exception("Could not record a mail attempt")


def server_said(exc: Exception) -> str:
    """What went wrong, in the server's words where it gave any, with every
    address taken out: "550 5.1.1 No such user here"."""
    if isinstance(exc, smtplib.SMTPRecipientsRefused) and exc.recipients:
        code, words = next(iter(exc.recipients.values()))
        said = f"{code} {_text(words)}"
    elif isinstance(exc, smtplib.SMTPResponseException):
        said = f"{exc.smtp_code} {_text(exc.smtp_error)}"
    else:
        said = f"{type(exc).__name__}: {exc}"
    return _ADDRESS.sub("<address>", said.strip())[:ERROR_CHARS]


def _text(words: object) -> str:
    if isinstance(words, bytes):
        return words.decode("utf-8", "replace")
    return str(words)


def get_mailer() -> Mailer:
    from lib_identity.usage import record_mail
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
        record=record_mail,
    )


def send_quietly(mailer: Mailer, to: str, subject: str, body: str) -> None:
    """Send from a background task, where a failure has nowhere to go.

    A background task runs after the response, so an exception from it reaches
    nobody who could act on it -- but it does reach the server, which drops the
    connection. With a mail host that is down or misspelt, that turned every
    sign-in from a new browser (#308) into a failed request. The mail is a
    courtesy; the request it follows has already succeeded, so log the failure
    and move on. A caller that can tell the user the mail failed calls
    `mailer.send` itself and handles the exception.
    """
    try:
        mailer.send(to, subject, body)
    except Exception:
        logger.exception("Could not send %r to %s", subject, to)

"""How much the instance is used, for a site admin (#312): Administration -> Usage.

The API cannot travel in time, so tests that need last week or last month
write the timestamps directly, as the report tests do.
"""

import smtplib
from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import select

import web
from lib_softtrack.tables import (
    ApiToken,
    Attachment,
    MailAttempt,
    OutboundWebhook,
    Ticket,
    TicketEvent,
    TicketEventField,
    User,
    WebhookDelivery,
    utcnow,
)
from lib_utils.mailer import get_mailer, server_said


def usage(client, actor):
    response = client.get("/admin/usage", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def make_team(client, actor, name, key):
    response = client.post(
        "/teams", json={"name": name, "key": key}, headers=actor["headers"]
    )
    assert response.status_code == 200, response.text
    return response.json()


def make_ticket(client, actor, team_id, title="Work"):
    response = client.post(
        f"/teams/{team_id}/tickets", json={"title": title}, headers=actor["headers"]
    )
    assert response.status_code == 200, response.text
    return response.json()


def monday(day):
    return day - timedelta(days=day.weekday())


# --- people ------------------------------------------------------------------


def test_people_are_counted_by_state_and_recent_sign_in(client, team, auth, session):
    now = utcnow()
    for email, last_login in (
        ("week@softtrack.dev", now - timedelta(days=3)),
        ("month@softtrack.dev", now - timedelta(days=20)),
        ("quarter@softtrack.dev", now - timedelta(days=60)),
    ):
        user_id = auth(email=email, full_name=email)["user"]["id"]
        user = session.get(User, user_id)
        user.last_login_at = last_login
        session.add(user)
    gone = session.get(User, auth(email="gone@softtrack.dev")["user"]["id"])
    gone.is_active = False
    gone.last_login_at = now - timedelta(days=200)
    session.add(gone)
    session.commit()
    # Made by a site admin, and never signed in (#303).
    response = client.post(
        "/admin/users",
        json={"full_name": "Nina Petrova", "email": "nina@softtrack.dev"},
        headers=team["headers"],
    )
    assert response.status_code == 201, response.text

    people = usage(client, team)["people"]

    # The admin, signed in just now, and the three above.
    assert people["active"] == 4
    assert people["not_activated"] == 1
    assert people["deactivated"] == 1
    assert people["signed_in_last_7_days"] == 2
    assert people["signed_in_last_30_days"] == 3


def test_a_deactivated_account_that_was_never_activated_counts_once(
    client, team, session
):
    response = client.post(
        "/admin/users",
        json={"full_name": "Nina Petrova", "email": "nina@softtrack.dev"},
        headers=team["headers"],
    )
    user = session.get(User, response.json()["user"]["id"])
    user.is_active = False
    session.add(user)
    session.commit()

    people = usage(client, team)["people"]

    assert (people["active"], people["not_activated"], people["deactivated"]) == (
        1,
        0,
        1,
    )


# --- work --------------------------------------------------------------------


def test_teams_in_use_and_archived_are_counted_apart(client, team):
    make_team(client, team, "Support", "SUP")
    old = make_team(client, team, "Hackday 2025", "HCK")
    response = client.post(f"/admin/teams/{old['id']}/archive", headers=team["headers"])
    assert response.status_code == 200, response.text

    work = usage(client, team)["work"]

    assert (work["teams"], work["archived_teams"]) == (2, 1)


def test_tickets_created_and_closed_are_counted_per_week_for_a_quarter(
    client, team, session
):
    team_id = team["team"]["id"]
    this_week = monday(utcnow().date())
    now = datetime.now(timezone.utc)

    def created(title, when):
        ticket = make_ticket(client, team, team_id, title)
        row = session.get(Ticket, ticket["id"])
        row.created_at = when
        session.add(row)
        session.commit()
        return ticket

    def closed(ticket, when, old="started", new="done"):
        session.add(
            TicketEvent(
                ticket_id=ticket["id"],
                team_id=team_id,
                field=TicketEventField.status,
                old_value=old,
                new_value=new,
                created_at=when,
            )
        )
        session.commit()

    a = created("A", now)
    b = created("B", now - timedelta(weeks=1))
    c = created("C", now - timedelta(weeks=1))
    created("D", now - timedelta(weeks=12))
    # A quarter and a week ago: before the first week shown.
    created("E", now - timedelta(weeks=14))
    closed(a, now)
    closed(b, now - timedelta(weeks=1), new="cancelled")
    # Reopened and closed again: each close counts, as in the reports.
    closed(c, now - timedelta(weeks=1), old="done", new="started")
    closed(c, now)
    # Moved between two closed statuses: not a close.
    closed(a, now, old="done", new="cancelled")

    weeks = usage(client, team)["work"]["weeks"]

    assert len(weeks) == 13
    assert weeks[-1]["week_of"] == this_week.isoformat()
    assert weeks[0]["week_of"] == (this_week - timedelta(weeks=12)).isoformat()
    by_week = {week["week_of"]: (week["created"], week["closed"]) for week in weeks}
    assert by_week[this_week.isoformat()] == (1, 2)
    assert by_week[(this_week - timedelta(weeks=1)).isoformat()] == (2, 1)
    assert by_week[(this_week - timedelta(weeks=12)).isoformat()] == (1, 0)
    assert sum(week["created"] for week in weeks) == 4


def test_a_ticket_in_the_trash_is_not_counted_as_created(client, team):
    ticket = make_ticket(client, team, team["team"]["id"])
    make_ticket(client, team, team["team"]["id"])
    response = client.delete(f"/tickets/{ticket['id']}", headers=team["headers"])
    assert response.status_code == 204, response.text

    weeks = usage(client, team)["work"]["weeks"]

    assert weeks[-1]["created"] == 1


# --- storage -----------------------------------------------------------------


def attach(session, ticket, filename, content_type, size_bytes, uploader_id):
    session.add(
        Attachment(
            ticket_id=ticket["id"],
            filename=filename,
            content_type=content_type,
            size_bytes=size_bytes,
            storage_key=f"key-{filename}",
            uploaded_by_id=uploader_id,
        )
    )
    session.commit()


def test_storage_is_counted_in_total_and_per_team_with_the_largest_files(
    client, team, session
):
    support = make_team(client, team, "Support", "SUP")
    make_team(client, team, "Product & Design", "PRD")
    eng_ticket = make_ticket(client, team, team["team"]["id"])
    sup_ticket = make_ticket(client, team, support["id"])
    uploader = team["user"]["id"]
    attach(session, eng_ticket, "demo.mp4", "video/mp4", 9_000, uploader)
    attach(session, eng_ticket, "logs.zip", "application/zip", 5_000, uploader)
    attach(session, eng_ticket, "notes.txt", "text/plain", 100, uploader)
    attach(session, sup_ticket, "screen.png", "image/png", 7_000, uploader)
    attach(session, sup_ticket, "invoice.pdf", "application/pdf", 3_000, uploader)
    attach(session, sup_ticket, "data.json", "application/json", 200, uploader)

    storage = usage(client, team)["storage"]

    assert (storage["size_bytes"], storage["files"]) == (24_300, 6)
    # Teams with nothing attached are left out.
    assert [(row["team_name"], row["size_bytes"]) for row in storage["teams"]] == [
        ("Engineering", 14_100),
        ("Support", 10_200),
    ]
    assert [
        (row["kind"], row["team_name"], row["size_bytes"]) for row in storage["largest"]
    ] == [
        ("video", "Engineering", 9_000),
        ("image", "Support", 7_000),
        ("archive", "Engineering", 5_000),
        ("document", "Support", 3_000),
        ("text", "Support", 200),
    ]


def test_files_in_the_trash_still_take_up_storage(client, team, session):
    ticket = make_ticket(client, team, team["team"]["id"])
    attach(session, ticket, "big.mov", "video/quicktime", 4_000, team["user"]["id"])
    response = client.delete(f"/tickets/{ticket['id']}", headers=team["headers"])
    assert response.status_code == 204, response.text

    storage = usage(client, team)["storage"]

    assert storage["size_bytes"] == 4_000
    assert storage["teams"][0]["size_bytes"] == 4_000
    assert storage["largest"][0]["kind"] == "video"


def test_the_page_names_teams_and_no_ticket_titles_or_file_names(client, team, session):
    ticket = make_ticket(client, team, team["team"]["id"], "Layoffs in March")
    attach(
        session, ticket, "salaries-2027.zip", "application/zip", 10, team["user"]["id"]
    )

    response = client.get("/admin/usage", headers=team["headers"])

    assert "Engineering" in response.text
    assert "Layoffs" not in response.text
    assert "salaries" not in response.text


# --- email -------------------------------------------------------------------


def test_email_sent_and_failed_are_counted_over_the_last_week_with_the_last_error(
    client, team, session
):
    now = utcnow()
    for ago, error in (
        (timedelta(minutes=5), None),
        (timedelta(days=3), None),
        (timedelta(days=2), "421 4.3.2 Service not available"),
        (timedelta(hours=1), "550 5.1.1 No such user here"),
        # Older than the week, and not yet swept.
        (timedelta(days=10), "554 5.7.1 Relay access denied"),
        (timedelta(days=10), None),
    ):
        session.add(MailAttempt(attempted_at=now - ago, error=error))
    session.commit()

    email = usage(client, team)["email"]

    assert (email["sent"], email["failed"]) == (2, 2)
    assert email["last_error"]["error"] == "550 5.1.1 No such user here"
    assert email["last_error"]["recipients"] == 1


def test_with_no_failures_in_the_week_there_is_no_last_error(client, team, session):
    session.add(
        MailAttempt(attempted_at=utcnow() - timedelta(days=9), error="550 old news")
    )
    session.commit()

    email = usage(client, team)["email"]

    assert email["last_error"] is None
    assert email["failed"] == 0


def test_whether_mail_is_configured_is_said(client, team, monkeypatch):
    monkeypatch.setattr(web.settings, "smtp_host", "")
    assert usage(client, team)["email"]["configured"] is False
    monkeypatch.setattr(web.settings, "smtp_host", "mail.example.com")
    assert usage(client, team)["email"]["configured"] is True


class FakeSMTP:
    """A mail server that refuses `refuse`, and takes everything else."""

    refuse: set[str] = set()

    def __init__(self, host, port, timeout=None):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self):
        pass

    def send_message(self, message):
        if message["To"] in self.refuse:
            raise smtplib.SMTPRecipientsRefused(
                {message["To"]: (550, b"5.1.1 No such user here")}
            )


@pytest.fixture
def mail_server(monkeypatch, session):
    """The real mailer against a fake server, recording into the test's own
    database rather than the app's."""
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(web.settings, "smtp_host", "mail.example.com")
    monkeypatch.setattr(web, "engine", session.get_bind())
    FakeSMTP.refuse = {"nobody@example.com"}
    return FakeSMTP


def test_the_mailer_records_a_refusal_in_the_servers_words_without_the_address(
    client, team, session, mail_server
):
    with pytest.raises(smtplib.SMTPRecipientsRefused):
        get_mailer().send("nobody@example.com", "Your invitation", "Join us")
    get_mailer().send("sam@example.com", "Your invitation", "Join us")

    rows = session.exec(select(MailAttempt).order_by(MailAttempt.id)).all()
    assert [(row.error, row.recipients) for row in rows] == [
        ("550 5.1.1 No such user here", 1),
        (None, 1),
    ]
    stored = " ".join(str(value) for row in rows for value in row.model_dump().values())
    assert "example.com" not in stored and "invitation" not in stored

    email = usage(client, team)["email"]
    assert (email["sent"], email["failed"]) == (1, 1)
    assert email["last_error"]["error"] == "550 5.1.1 No such user here"


def test_recording_a_send_sweeps_what_is_older_than_the_week(session, mail_server):
    session.add(MailAttempt(attempted_at=utcnow() - timedelta(days=8), error="old"))
    session.add(MailAttempt(attempted_at=utcnow() - timedelta(days=6), error="kept"))
    session.commit()

    get_mailer().send("sam@example.com", "s", "b")

    session.expire_all()
    assert [row.error for row in session.exec(select(MailAttempt)).all()] == [
        "kept",
        None,
    ]


def test_a_mail_server_that_names_the_address_has_it_taken_out():
    refused = smtplib.SMTPDataError(
        550, b"5.1.1 <sam@example.com>: Recipient address rejected"
    )
    assert server_said(refused) == "550 5.1.1 <address>: Recipient address rejected"
    assert server_said(ConnectionRefusedError(111, "Connection refused")) == (
        "ConnectionRefusedError: [Errno 111] Connection refused"
    )


# --- webhooks and API tokens -------------------------------------------------


def test_failed_webhook_deliveries_are_counted_by_team(client, team, session):
    support = make_team(client, team, "Support", "SUP")
    # A team with no webhooks is not listed.
    make_team(client, team, "Product & Design", "PRD")

    def hook(team_id, *statuses):
        row = OutboundWebhook(
            team_id=team_id,
            url="https://93.184.216.34/hook",
            secret="s",
            events="ticket.created",
            created_by_id=team["user"]["id"],
        )
        session.add(row)
        session.commit()
        for status in statuses:
            session.add(
                WebhookDelivery(
                    webhook_id=row.id, event="ping", payload="{}", status=status
                )
            )
        session.commit()

    hook(team["team"]["id"], "failed", "failed", "succeeded", "pending")
    hook(team["team"]["id"], "failed")
    hook(support["id"], "succeeded")

    webhooks = usage(client, team)["webhooks"]

    assert [(row["team_name"], row["failed"]) for row in webhooks] == [
        ("Engineering", 3),
        ("Support", 0),
    ]


def test_live_tokens_are_counted_with_the_ones_never_used(client, team, auth, session):
    def token(actor, name):
        response = client.post(
            "/auth/me/tokens", json={"name": name}, headers=actor["headers"]
        )
        assert response.status_code == 200, response.text
        return response.json()

    def edit(created, **fields):
        row = session.get(ApiToken, created["id"])
        for name, value in fields.items():
            setattr(row, name, value)
        session.add(row)
        session.commit()

    token(team, "never used")
    edit(token(team, "used"), last_used_at=utcnow())
    edit(token(team, "expired"), expires_at=utcnow() - timedelta(days=1))
    revoked = token(team, "revoked")
    response = client.delete(
        f"/auth/me/tokens/{revoked['id']}", headers=team["headers"]
    )
    assert response.status_code == 204, response.text
    leaver = auth(email="leaver@softtrack.dev")
    token(leaver, "theirs")
    gone = session.get(User, leaver["user"]["id"])
    gone.is_active = False
    session.add(gone)
    session.commit()

    tokens = usage(client, team)["api_tokens"]

    assert (tokens["live"], tokens["never_used"]) == (2, 1)


# --- who may see it ----------------------------------------------------------


def test_only_a_site_admin_sees_usage(client, team, auth):
    member = auth(email="member@softtrack.dev")

    response = client.get("/admin/usage", headers=member["headers"])

    assert response.status_code == 403
    assert response.json()["code"] == "not_site_admin"

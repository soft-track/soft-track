"""The batched email digest (issue #18).

Email is the optional half of notifications, so the thing under test here is
mostly restraint: what does *not* get mailed, and what does not get mailed
twice.
"""

from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import select

from lib_softtrack.digest import render_digest, send_pending_digests
from lib_softtrack.notifications import expand_notifications
from lib_softtrack.tables import Notification, User

BASE_URL = "https://track.example.com"


class FakeMailer:
    """Records instead of sending. The seam `Mailer` exists for."""

    def __init__(self, fail=False):
        self.sent: list[tuple[str, str, str]] = []
        self.fail = fail

    def send(self, to: str, subject: str, body: str) -> None:
        if self.fail:
            raise RuntimeError("relay refused")
        self.sent.append((to, subject, body))


@pytest.fixture
def pair(client, team, auth):
    member = auth(email="member@softtrack.dev", full_name="Plain Member")
    client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": "member@softtrack.dev"},
        headers=team["headers"],
    )
    return {**team, "member": member}


@pytest.fixture
def notified(client, pair):
    """One unread `commented` notification waiting for the team's admin."""
    issue = client.post(
        f"/teams/{pair['team']['id']}/issues",
        json={"title": "The bug"},
        headers=pair["headers"],
    ).json()
    client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "Reproduced on staging"},
        headers=pair["member"]["headers"],
    )
    return pair


def later(minutes=60) -> datetime:
    return datetime.now(timezone.utc) + timedelta(minutes=minutes)


def send(session, mailer, now=None, delay_minutes=10):
    return send_pending_digests(
        session, mailer, BASE_URL, delay_minutes, now=now or later()
    )


# --- what the mail says -------------------------------------------------


def test_one_notification_names_it_in_the_subject(session, notified):
    items = expand_notifications(
        session, list(session.exec(select(Notification)).all())
    )
    subject, body = render_digest(items, BASE_URL)

    assert subject == "SoftTrack: Plain Member commented on ENG-1"
    assert "The bug" in body
    assert "“Reproduced on staging”" in body
    # The link goes to the app's own route for the issue, not to the API.
    assert f"{BASE_URL}/ENG/issue/1" in body


def test_several_notifications_are_counted_in_the_subject(session, notified, client):
    issue_id = session.exec(select(Notification)).first().issue_id
    client.post(
        f"/issues/{issue_id}/comments",
        json={"body": "And on prod"},
        headers=notified["member"]["headers"],
    )

    items = expand_notifications(
        session, list(session.exec(select(Notification)).all())
    )
    subject, _ = render_digest(items, BASE_URL)
    assert subject == "SoftTrack: 2 new notifications"


def _item(kind, actor="Sam Rivera", identifier="ENG-1", number=1):
    """One NotificationRead, built without a database.

    `render_digest` is a pure function over the payload the inbox already
    returns, so the sentences it produces can be checked without arranging the
    events that would raise them.
    """
    from lib_identity.models.identity import UserPublic
    from lib_softtrack.models.notifications import NotificationIssue, NotificationRead

    return NotificationRead(
        id=number,
        kind=kind,
        issue=NotificationIssue(
            id=number,
            team_id=1,
            team_key="ENG",
            number=number,
            identifier=identifier,
            title="The bug",
        ),
        actor=(
            UserPublic(
                id=2,
                email="sam@example.com",
                username="sam",
                full_name=actor,
                avatar_color="#6366f1",
                is_active=True,
            )
            if actor
            else None
        ),
        read=False,
        created_at=datetime.now(timezone.utc),
    )


@pytest.mark.parametrize(
    "kind,sentence",
    [
        ("assigned", "Sam Rivera assigned ENG-1 to you"),
        ("mentioned", "Sam Rivera mentioned you on ENG-1"),
        ("commented", "Sam Rivera commented on ENG-1"),
        ("status_changed", "Sam Rivera changed the status of ENG-1"),
    ],
)
def test_every_kind_has_its_own_sentence(kind, sentence):
    subject, body = render_digest([_item(kind)], BASE_URL)
    assert subject == f"SoftTrack: {sentence}"
    assert f"* {sentence}" in body


def test_something_no_person_did_still_reads_as_a_sentence(session):
    """An import has no actor -- see Notification.actor_id."""
    subject, _ = render_digest([_item("assigned", actor=None)], BASE_URL)
    assert subject == "SoftTrack: Someone assigned ENG-1 to you"


def test_a_very_long_batch_is_cut_off_with_a_count(session):
    """Past a certain length the mail stops being readable and the inbox is
    the better place to look, which the last line says."""
    items = [_item("commented", number=n) for n in range(1, 26)]
    _, body = render_digest(items, BASE_URL)

    assert body.count("* Sam Rivera commented") == 20
    assert "…and 5 more." in body
    assert "Read them in SoftTrack:" in body


def test_a_trailing_slash_on_the_base_url_does_not_double_up(session, notified):
    items = expand_notifications(
        session, list(session.exec(select(Notification)).all())
    )
    _, body = render_digest(items, BASE_URL + "/")
    assert "//ENG/issue" not in body


# --- who gets one -------------------------------------------------------


def test_an_unread_notification_is_mailed(session, notified):
    mailer = FakeMailer()
    assert send(session, mailer) == 1

    to, subject, _ = mailer.sent[0]
    assert to == "demo@softtrack.dev"
    assert subject.startswith("SoftTrack:")


def test_a_notification_read_before_the_digest_runs_is_not_mailed(
    session, notified, client
):
    client.post("/notifications/read-all", headers=notified["headers"])

    mailer = FakeMailer()
    assert send(session, mailer) == 0


def test_a_fresh_notification_waits_for_the_next_run(session, notified):
    """The delay is what makes this a digest: a burst becomes one mail."""
    mailer = FakeMailer()
    assert send(session, mailer, now=datetime.now(timezone.utc)) == 0
    assert send(session, mailer, now=later()) == 1


def test_switching_email_off_stops_the_mail(session, notified, client):
    client.patch(
        "/notifications/settings",
        json={"email_notifications": False},
        headers=notified["headers"],
    )

    mailer = FakeMailer()
    assert send(session, mailer) == 0
    # Still in the inbox, which is the point of the switch being about email.
    assert session.exec(select(Notification)).all() != []


def test_a_deactivated_account_is_not_mailed(session, notified):
    user = session.exec(select(User).where(User.email == "demo@softtrack.dev")).one()
    user.is_active = False
    session.add(user)
    session.commit()

    assert send(session, FakeMailer()) == 0


# --- exactly once -------------------------------------------------------


def test_the_same_notification_is_not_mailed_twice(session, notified):
    mailer = FakeMailer()
    assert send(session, mailer) == 1
    assert send(session, mailer) == 0
    assert len(mailer.sent) == 1


def test_a_claimed_notification_stays_claimed_when_the_relay_fails(session, notified):
    """It is already in the inbox, so nothing is lost by not retrying -- and a
    relay that rejects everything would otherwise have the loop re-sending the
    same batch every tick for as long as it stays broken."""
    assert send(session, FakeMailer(fail=True)) == 0

    row = session.exec(select(Notification)).first()
    session.refresh(row)
    assert row.emailed_at is not None
    assert send(session, FakeMailer()) == 0


def test_one_mail_per_person_however_many_notifications(session, notified, client):
    issue_id = session.exec(select(Notification)).first().issue_id
    for body in ("one", "two", "three"):
        client.post(
            f"/issues/{issue_id}/comments",
            json={"body": body},
            headers=notified["member"]["headers"],
        )

    mailer = FakeMailer()
    assert send(session, mailer) == 1
    assert len(mailer.sent) == 1
    assert "4 new notifications" in mailer.sent[0][1]

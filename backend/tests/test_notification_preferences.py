"""Which notifications reach you, kind by kind, and muting a team (#263).

The defaults are what happened before there was a choice, so most of what is
guarded here is that a switch nobody touched changes nothing -- and that the
two kinds which are the tracker reaching you at all cannot be switched off.
"""

from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import select

from lib_softtrack.digest import send_pending_digests
from lib_softtrack.notification_kinds import KINDS, spec_for
from lib_softtrack.tables import Notification, NotificationKind, User

from tests.test_digest import FakeMailer
from tests.test_notifications import comment, inbox, make_ticket, set_watching


@pytest.fixture
def pair(client, team, auth):
    member = auth(email="member@softtrack.dev", full_name="Plain Member")
    response = client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": "member@softtrack.dev"},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return {**team, "member": member}


@pytest.fixture
def smtp(monkeypatch):
    from web import settings

    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")


def get(client, actor):
    response = client.get("/notifications/settings", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def patch(client, actor, **body):
    return client.patch("/notifications/settings", json=body, headers=actor["headers"])


def choose(client, actor, kind, channel, enabled):
    response = patch(
        client,
        actor,
        preferences=[{"kind": kind, "channel": channel, "enabled": enabled}],
    )
    assert response.status_code == 200, response.text
    return response.json()


def grid(settings):
    return {
        row["kind"]: {c["channel"]: c["enabled"] for c in row["channels"]}
        for row in settings["kinds"]
    }


def mail(session):
    mailer = FakeMailer()
    send_pending_digests(
        session,
        mailer,
        "https://track.example.com",
        10,
        now=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    return mailer.sent


def change_status(client, actor, ticket, status_id):
    response = client.patch(
        f"/tickets/{ticket['id']}",
        json={"status_id": status_id},
        headers=actor["headers"],
    )
    assert response.status_code == 200, response.text


# --- the registry ----------------------------------------------------------


def test_every_kind_is_registered():
    """A kind raised without a row on the page would be one nobody can turn off."""
    for kind in NotificationKind:
        assert spec_for(kind).key in KINDS


def test_being_named_in_a_field_rides_on_the_assigned_switch():
    assert spec_for(NotificationKind.field_assigned) is spec_for(
        NotificationKind.assigned
    )


# --- the page --------------------------------------------------------------


def test_without_a_mail_server_there_is_no_email_column(client, pair):
    settings = get(client, pair)

    assert settings["email_delivery_configured"] is False
    assert settings["channels"] == ["app"]
    assert [row["kind"] for row in settings["kinds"]] == [
        "assigned",
        "mentioned",
        "commented",
        "status_changed",
    ]
    assigned = settings["kinds"][0]
    assert assigned["name"] == "Assigned to you"
    assert assigned["description"] == "A ticket becomes yours."
    assert assigned["channels"] == [{"channel": "app", "enabled": True, "locked": True}]
    assert settings["kinds"][2]["channels"] == [
        {"channel": "app", "enabled": True, "locked": False}
    ]
    assert settings["teams"] == [
        {
            "team_id": pair["team"]["id"],
            "key": "ENG",
            "name": "Engineering",
            "muted": False,
        }
    ]


def test_the_defaults_are_everything_everywhere(client, pair, smtp):
    settings = get(client, pair)

    assert settings["channels"] == ["app", "email"]
    assert grid(settings) == {kind: {"app": True, "email": True} for kind in KINDS}


def test_somebody_who_had_turned_email_off_keeps_it_off(client, pair, smtp, session):
    user = session.exec(select(User).where(User.email == "member@softtrack.dev")).one()
    user.email_notifications = False
    session.add(user)
    session.commit()

    assert grid(get(client, pair["member"])) == {
        kind: {"app": True, "email": False} for kind in KINDS
    }


def test_a_choice_is_saved_and_shown(client, pair, smtp):
    settings = choose(client, pair, "status_changed", "email", False)

    assert grid(settings)["status_changed"] == {"app": True, "email": False}
    assert grid(get(client, pair))["status_changed"] == {"app": True, "email": False}
    # Somebody else's grid is their own.
    assert grid(get(client, pair["member"]))["status_changed"]["email"] is True


# --- what may not be chosen ----------------------------------------------


@pytest.mark.parametrize("kind", ["assigned", "mentioned"])
def test_assigned_and_mentioned_stay_on_in_the_app(client, pair, smtp, kind):
    response = patch(
        client,
        pair,
        preferences=[{"kind": kind, "channel": "app", "enabled": False}],
    )
    assert response.status_code == 400, response.text
    assert response.json()["code"] == "notification_always_on"

    # By email they are a choice like any other.
    assert grid(choose(client, pair, kind, "email", False))[kind]["email"] is False


def test_no_email_choice_without_a_mail_server(client, pair):
    response = patch(
        client,
        pair,
        preferences=[{"kind": "commented", "channel": "email", "enabled": False}],
    )
    assert response.status_code == 400, response.text
    assert response.json()["code"] == "notification_channel_unavailable"


def test_an_unknown_kind_is_refused(client, pair):
    response = patch(
        client,
        pair,
        preferences=[{"kind": "horoscope", "channel": "app", "enabled": False}],
    )
    assert response.status_code == 404, response.text
    assert response.json()["code"] == "notification_kind_not_found"


def test_a_refused_change_saves_nothing(client, pair):
    response = patch(
        client,
        pair,
        preferences=[
            {"kind": "commented", "channel": "app", "enabled": False},
            {"kind": "assigned", "channel": "app", "enabled": False},
        ],
    )
    assert response.status_code == 400, response.text
    assert grid(get(client, pair))["commented"]["app"] is True


def test_only_a_team_you_are_on_can_be_muted(client, pair, auth):
    stranger = auth(email="stranger@softtrack.dev")
    response = patch(
        client, stranger, teams=[{"team_id": pair["team"]["id"], "muted": True}]
    )
    assert response.status_code == 403, response.text
    assert response.json()["code"] == "not_team_member"


# --- what arrives -----------------------------------------------------------


def test_a_kind_off_in_the_app_stops_arriving_there(client, pair):
    ticket = make_ticket(client, pair, pair["team"])
    set_watching(client, pair["member"], ticket, True)
    choose(client, pair["member"], "status_changed", "app", False)

    change_status(client, pair, ticket, pair["status_ids"]["Done"])
    assert inbox(client, pair["member"]) == []

    # Other kinds are untouched.
    comment(client, pair, ticket, "shipped")
    assert [item["kind"] for item in inbox(client, pair["member"])] == ["commented"]


def test_off_in_the_app_and_on_by_email_is_mailed_and_not_shown(
    client, pair, smtp, session
):
    ticket = make_ticket(client, pair, pair["team"])
    set_watching(client, pair["member"], ticket, True)
    choose(client, pair["member"], "status_changed", "app", False)

    change_status(client, pair, ticket, pair["status_ids"]["Done"])

    assert inbox(client, pair["member"]) == []
    unread = client.get(
        "/notifications/unread-count", headers=pair["member"]["headers"]
    ).json()
    assert unread == {"unread": 0}
    (sent,) = mail(session)
    assert sent[0] == "member@softtrack.dev"
    assert "changed the status of ENG-1" in sent[1]


def test_off_by_email_stays_in_the_inbox_and_is_not_mailed(client, pair, smtp, session):
    ticket = make_ticket(client, pair, pair["team"])
    set_watching(client, pair["member"], ticket, True)
    choose(client, pair["member"], "status_changed", "email", False)

    change_status(client, pair, ticket, pair["status_ids"]["Done"])
    assert [item["kind"] for item in inbox(client, pair["member"])] == [
        "status_changed"
    ]
    assert mail(session) == []

    # A comment, still on by email, is mailed.
    comment(client, pair, ticket, "shipped")
    (sent,) = mail(session)
    assert sent[1] == "SoftTrack: Demo User commented on ENG-1"


def test_off_on_both_raises_nothing(client, pair, smtp, session):
    ticket = make_ticket(client, pair, pair["team"])
    set_watching(client, pair["member"], ticket, True)
    choose(client, pair["member"], "commented", "app", False)
    choose(client, pair["member"], "commented", "email", False)

    comment(client, pair, ticket, "hello")
    assert (
        session.exec(
            select(Notification).where(Notification.kind == NotificationKind.commented)
        ).all()
        == []
    )


def test_email_back_on_for_one_kind_after_the_old_switch_went_off(
    client, pair, smtp, session
):
    user = session.exec(select(User).where(User.email == "member@softtrack.dev")).one()
    user.email_notifications = False
    session.add(user)
    session.commit()
    choose(client, pair["member"], "commented", "email", True)

    ticket = make_ticket(client, pair, pair["team"])
    set_watching(client, pair["member"], ticket, True)
    change_status(client, pair, ticket, pair["status_ids"]["Done"])
    comment(client, pair, ticket, "hello")

    (sent,) = mail(session)
    assert "commented on ENG-1" in sent[1]
    assert "changed the status" not in sent[2]


# --- muting a team ---------------------------------------------------------


def test_a_muted_team_still_assigns_and_mentions(client, pair):
    response = patch(
        client,
        pair["member"],
        teams=[{"team_id": pair["team"]["id"], "muted": True}],
    )
    assert response.status_code == 200, response.text
    assert response.json()["teams"][0]["muted"] is True

    ticket = make_ticket(client, pair, pair["team"])
    set_watching(client, pair["member"], ticket, True)
    change_status(client, pair, ticket, pair["status_ids"]["Done"])
    comment(client, pair, ticket, "shipped")
    assert inbox(client, pair["member"]) == []

    comment(client, pair, ticket, "over to you @member")
    make_ticket(client, pair, pair["team"], assignee_id=pair["member"]["user"]["id"])
    assert sorted(item["kind"] for item in inbox(client, pair["member"])) == [
        "assigned",
        "mentioned",
    ]


def test_unmuting_a_team_lets_it_back_in(client, pair):
    team_id = pair["team"]["id"]
    patch(client, pair["member"], teams=[{"team_id": team_id, "muted": True}])
    patch(client, pair["member"], teams=[{"team_id": team_id, "muted": False}])

    ticket = make_ticket(client, pair, pair["team"])
    set_watching(client, pair["member"], ticket, True)
    comment(client, pair, ticket, "shipped")
    assert [item["kind"] for item in inbox(client, pair["member"])] == ["commented"]

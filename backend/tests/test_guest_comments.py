"""Guests may comment (#244): the answer stays on the ticket that asked.

A team setting, off by default. With it on, a guest can write a comment,
attach files to it, react, and edit or delete their own. They still change
nothing else, their comment carries only the files they uploaded for it,
and the sweep in tests/test_guest_role.py keeps every other write shut.
"""

import io

import pytest
from sqlmodel import select

from lib_softtrack.tables import Attachment, Notification

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture
def room(client, team, auth):
    """ENG, a member, a guest from the client, and a ticket with a question."""
    team_id = team["team"]["id"]

    def join(email, name, role):
        person = auth(email=email, full_name=name)
        response = client.post(
            f"/teams/{team_id}/members",
            json={"email": email, "role": role},
            headers=team["headers"],
        )
        assert response.status_code == 200, response.text
        return person

    daniel = join("daniel@softtrack.dev", "Daniel Okafor", "member")
    sofia = join("sofia@client.dev", "Sofia Marin", "guest")
    ticket = client.post(
        f"/teams/{team_id}/tickets",
        json={"title": "Portal: sign-in with magic link"},
        headers=team["headers"],
    ).json()
    asked = client.post(
        f"/tickets/{ticket['id']}/comments",
        json={"body": "@sofia is a link by email enough for the pilot?"},
        headers=daniel["headers"],
    ).json()
    return {
        **team,
        "team_id": team_id,
        "daniel": daniel,
        "sofia": sofia,
        "ticket": ticket,
        "asked": asked,
    }


def let_guests_comment(client, room, value=True):
    response = client.patch(
        f"/teams/{room['team_id']}",
        json={"guests_may_comment": value},
        headers=room["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def comment(client, room, actor, body, **fields):
    return client.post(
        f"/tickets/{room['ticket']['id']}/comments",
        json={"body": body, **fields},
        headers=actor["headers"],
    )


def upload(client, room, actor):
    return client.post(
        f"/tickets/{room['ticket']['id']}/attachments",
        files={"file": ("screen.png", io.BytesIO(PNG), "image/png")},
        headers=actor["headers"],
    )


def test_it_is_off_until_a_team_admin_turns_it_on(client, room):
    assert room["team"]["guests_may_comment"] is False
    refused = comment(client, room, room["sofia"], "Yes, that works for us.")
    assert refused.status_code == 403
    assert refused.json() == {
        "detail": "Guests of this team read the conversation and do not comment",
        "code": "team_read_only",
    }
    # Only an admin changes it.
    response = client.patch(
        f"/teams/{room['team_id']}",
        json={"guests_may_comment": True},
        headers=room["daniel"]["headers"],
    )
    assert response.status_code == 403
    assert let_guests_comment(client, room)["guests_may_comment"] is True


def test_a_guest_answers_and_the_person_they_mention_is_told(client, room, session):
    let_guests_comment(client, room)
    response = comment(
        client, room, room["sofia"], "Yes. @daniel one link, fifteen minutes."
    )
    assert response.status_code == 200, response.text
    assert response.json()["author"]["full_name"] == "Sofia Marin"
    told = session.exec(
        select(Notification).where(Notification.user_id == room["daniel"]["user"]["id"])
    ).all()
    assert len(told) == 1


def test_a_guest_attaches_a_file_to_their_comment(client, room, session):
    let_guests_comment(client, room)
    uploaded = upload(client, room, room["sofia"])
    assert uploaded.status_code == 200, uploaded.text

    # A draft's file is not the ticket's, not even for a moment.
    ticket_files = client.get(
        f"/tickets/{room['ticket']['id']}/attachments", headers=room["headers"]
    ).json()
    assert ticket_files == []

    posted = comment(
        client,
        room,
        room["sofia"],
        "Here is what our pilot users see.",
        attachment_ids=[uploaded.json()["id"]],
    )
    assert posted.status_code == 200, posted.text
    assert [a["filename"] for a in posted.json()["attachments"]] == ["screen.png"]


def test_a_member_made_a_guest_keeps_the_files_they_put_on_tickets(client, room):
    """A draft is whatever a guest uploads, recorded at the upload: the files
    somebody attached while a member stay the ticket's after they become a
    guest."""
    put_there = upload(client, room, room["daniel"]).json()
    response = client.patch(
        f"/teams/{room['team_id']}/members/{room['daniel']['user']['id']}",
        json={"role": "guest"},
        headers=room["headers"],
    )
    assert response.status_code == 200, response.text

    ticket_files = client.get(
        f"/tickets/{room['ticket']['id']}/attachments", headers=room["headers"]
    ).json()
    assert [a["id"] for a in ticket_files] == [put_there["id"]]


def test_a_guests_comment_cannot_take_the_tickets_own_files(client, room):
    let_guests_comment(client, room)
    theirs = upload(client, room, room).json()
    refused = comment(
        client, room, room["sofia"], "Taking this.", attachment_ids=[theirs["id"]]
    )
    assert refused.status_code == 400
    assert refused.json()["code"] == "attachment_not_attachable"


def test_a_guest_removes_their_own_file_and_nobody_elses(client, room, session):
    let_guests_comment(client, room)
    mine = upload(client, room, room["sofia"]).json()
    theirs = upload(client, room, room).json()

    refused = client.delete(
        f"/attachments/{theirs['id']}", headers=room["sofia"]["headers"]
    )
    assert refused.status_code == 403
    assert refused.json()["code"] == "not_your_attachment"
    removed = client.delete(
        f"/attachments/{mine['id']}", headers=room["sofia"]["headers"]
    )
    assert removed.status_code == 204
    assert [a.id for a in session.exec(select(Attachment)).all()] == [theirs["id"]]


def test_a_guest_edits_and_deletes_their_own_comment_only(client, room):
    let_guests_comment(client, room)
    theirs = comment(client, room, room["sofia"], "Yes.").json()

    edited = client.patch(
        f"/comments/{theirs['id']}",
        json={"body": "Yes, for the pilot."},
        headers=room["sofia"]["headers"],
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["body"] == "Yes, for the pilot."

    not_theirs = client.patch(
        f"/comments/{room['asked']['id']}",
        json={"body": "Rewritten"},
        headers=room["sofia"]["headers"],
    )
    assert not_theirs.status_code == 403
    assert not_theirs.json()["code"] == "not_your_comment"
    assert (
        client.delete(
            f"/comments/{room['asked']['id']}", headers=room["sofia"]["headers"]
        ).status_code
        == 403
    )
    assert (
        client.delete(
            f"/comments/{theirs['id']}", headers=room["sofia"]["headers"]
        ).status_code
        == 204
    )


def test_a_guest_reacts(client, room):
    let_guests_comment(client, room)
    response = client.put(
        f"/comments/{room['asked']['id']}/reactions/thumbs_up",
        headers=room["sofia"]["headers"],
    )
    assert response.status_code == 200, response.text
    assert response.json()[0]["count"] == 1


def test_they_still_change_nothing_else(client, room):
    let_guests_comment(client, room)
    for method, path, body in (
        ("PATCH", f"/tickets/{room['ticket']['id']}", {"title": "Mine now"}),
        ("POST", f"/teams/{room['team_id']}/tickets", {"title": "A new one"}),
    ):
        response = client.request(
            method, path, json=body, headers=room["sofia"]["headers"]
        )
        assert response.status_code == 403, (method, path)
        assert response.json()["code"] == "team_read_only"


def test_turning_it_off_closes_the_conversation_again(client, room):
    let_guests_comment(client, room)
    theirs = comment(client, room, room["sofia"], "Yes.").json()
    let_guests_comment(client, room, False)
    for response in (
        comment(client, room, room["sofia"], "One more thing."),
        client.patch(
            f"/comments/{theirs['id']}",
            json={"body": "Edited"},
            headers=room["sofia"]["headers"],
        ),
    ):
        assert response.status_code == 403
        assert response.json()["code"] == "team_read_only"

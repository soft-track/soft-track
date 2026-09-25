"""Editing and deleting comments (#93).

Who may: the author edits, the author or a team admin deletes -- and an admin
never edits, because words under somebody's name should be words they wrote.
What goes with a deleted comment: its files (rows and bytes), its reactions,
and the notifications about it.
"""

import io

import pytest
from sqlmodel import select

from lib_softtrack.storage import ObjectNotFound
from lib_softtrack.tables import (
    Attachment,
    Comment,
    CommentReaction,
    Notification,
)

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def join(client, team, person, role="member"):
    response = client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": person["user"]["email"], "role": role},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text


@pytest.fixture
def people(client, team, auth):
    """The team's admin (`team`), two plain members, and a guest."""
    maya = auth(email="maya@softtrack.dev", full_name="Maya Chen")
    sam = auth(email="sam@softtrack.dev", full_name="Sam Ortiz")
    gus = auth(email="gus@softtrack.dev", full_name="Gus Guest")
    join(client, team, maya)
    join(client, team, sam)
    join(client, team, gus, role="guest")
    return {"admin": team, "maya": maya, "sam": sam, "guest": gus}


@pytest.fixture
def issue(client, team):
    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": "Retry storm"},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def post(client, actor, issue, body, **extra):
    response = client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": body, **extra},
        headers=actor["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def edit(client, actor, comment, body):
    return client.patch(
        f"/comments/{comment['id']}", json={"body": body}, headers=actor["headers"]
    )


def delete(client, actor, comment):
    return client.delete(f"/comments/{comment['id']}", headers=actor["headers"])


def thread(client, actor, issue):
    response = client.get(f"/issues/{issue['id']}/comments", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()


# --- editing ------------------------------------------------------------


def test_a_new_comment_has_not_been_edited(client, people, issue):
    assert post(client, people["maya"], issue, "Looking")["edited_at"] is None


def test_the_author_can_edit_their_comment(client, people, issue):
    comment = post(client, people["maya"], issue, "Fixed by bakcing off.")

    response = edit(client, people["maya"], comment, "Fixed by backing off.")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["body"] == "Fixed by backing off."
    assert body["edited_at"] is not None
    assert body["author"]["full_name"] == "Maya Chen"

    [listed] = thread(client, people["sam"], issue)["items"]
    assert listed["body"] == "Fixed by backing off."
    assert listed["edited_at"] == body["edited_at"]


def test_saving_the_same_body_is_not_an_edit(client, people, issue):
    """Opening the editor and pressing Save should not stamp "(edited)"."""
    comment = post(client, people["maya"], issue, "Unchanged")
    response = edit(client, people["maya"], comment, "Unchanged")
    assert response.status_code == 200, response.text
    assert response.json()["edited_at"] is None


def test_an_edit_keeps_the_comments_files_and_reactions(client, people, issue):
    upload = client.post(
        f"/issues/{issue['id']}/attachments",
        files={"file": ("shot.png", io.BytesIO(PNG), "image/png")},
        headers=people["maya"]["headers"],
    ).json()
    comment = post(
        client, people["maya"], issue, "See ![](x)", attachment_ids=[upload["id"]]
    )
    client.put(
        f"/comments/{comment['id']}/reactions/heart", headers=people["sam"]["headers"]
    )

    body = edit(client, people["maya"], comment, "See the screenshot").json()
    assert [a["id"] for a in body["attachments"]] == [upload["id"]]
    assert [r["emoji"] for r in body["reactions"]] == ["heart"]


def test_nobody_else_can_edit_a_comment(client, people, issue):
    comment = post(client, people["maya"], issue, "Mine")

    response = edit(client, people["sam"], comment, "Not any more")
    assert response.status_code == 403
    assert response.json()["code"] == "not_your_comment"


def test_a_team_admin_cannot_edit_somebody_elses_comment(client, people, issue):
    """An admin may take a comment down, but never put words in its author's mouth."""
    comment = post(client, people["maya"], issue, "Mine")

    response = edit(client, people["admin"], comment, "Words Maya never wrote")
    assert response.status_code == 403
    assert response.json()["code"] == "not_your_comment"
    assert thread(client, people["maya"], issue)["items"][0]["body"] == "Mine"


def test_an_empty_body_is_refused(client, people, issue):
    comment = post(client, people["maya"], issue, "Something")
    assert edit(client, people["maya"], comment, "").status_code == 422


def test_editing_a_missing_comment_is_a_404(client, people):
    response = client.patch(
        "/comments/9999", json={"body": "x"}, headers=people["maya"]["headers"]
    )
    assert response.status_code == 404
    assert response.json()["code"] == "comment_not_found"


def test_an_outsider_cannot_edit_or_delete(client, auth, people, issue):
    comment = post(client, people["maya"], issue, "Team business")
    outsider = auth(email="out@softtrack.dev", full_name="Out Sider")

    assert edit(client, outsider, comment, "hi").json()["code"] == "not_team_member"
    assert delete(client, outsider, comment).json()["code"] == "not_team_member"


def test_a_guest_can_neither_edit_nor_delete(client, people, issue):
    comment = post(client, people["maya"], issue, "Members only")

    assert edit(client, people["guest"], comment, "hi").json()["code"] == (
        "team_read_only"
    )
    assert delete(client, people["guest"], comment).json()["code"] == ("team_read_only")


def test_an_edit_tells_only_the_people_it_newly_mentions(
    client, session, people, issue
):
    """Fixing a typo should not re-ping everybody the comment already named."""
    comment = post(client, people["maya"], issue, "cc @sam, @adminn")
    before = session.exec(select(Notification)).all()

    response = edit(client, people["maya"], comment, "cc @sam, @demo")
    assert response.status_code == 200, response.text

    new = [row for row in session.exec(select(Notification)).all() if row not in before]
    assert [(row.user_id, row.kind.value) for row in new] == [
        (people["admin"]["user"]["id"], "mentioned")
    ]
    assert new[0].comment_id == comment["id"]


def test_search_finds_the_edited_words_and_not_the_old_ones(client, people, issue):
    comment = post(client, people["maya"], issue, "the flux capacitor is leaking")
    edit(client, people["maya"], comment, "the warp coil is leaking")

    def hits(query):
        response = client.get(
            "/search", params={"q": query}, headers=people["maya"]["headers"]
        )
        assert response.status_code == 200, response.text
        return [hit["id"] for hit in response.json()["items"]]

    assert hits("warp") == [issue["id"]]
    assert hits("capacitor") == []


# --- deleting -----------------------------------------------------------


def test_the_author_can_delete_their_comment(client, people, issue):
    keep = post(client, people["sam"], issue, "Staying")
    comment = post(client, people["maya"], issue, "Wrong issue, sorry")

    response = delete(client, people["maya"], comment)
    assert response.status_code == 204, response.text

    listed = thread(client, people["maya"], issue)
    assert [c["id"] for c in listed["items"]] == [keep["id"]]
    assert listed["total"] == 1


def test_a_team_admin_can_delete_anybodys_comment(client, people, issue):
    comment = post(client, people["maya"], issue, "Off topic")
    assert delete(client, people["admin"], comment).status_code == 204
    assert thread(client, people["admin"], issue)["items"] == []


def test_a_member_cannot_delete_somebody_elses_comment(client, people, issue):
    comment = post(client, people["maya"], issue, "Mine")

    response = delete(client, people["sam"], comment)
    assert response.status_code == 403
    assert response.json()["code"] == "not_your_comment"
    assert len(thread(client, people["sam"], issue)["items"]) == 1


def test_deleting_a_missing_comment_is_a_404(client, people):
    response = client.delete("/comments/9999", headers=people["maya"]["headers"])
    assert response.status_code == 404
    assert response.json()["code"] == "comment_not_found"


def test_an_automation_comment_can_be_deleted_by_an_admin_and_edited_by_nobody(
    client, session, people, issue
):
    """A rule's comment has no author, so there is nobody whose words it are."""
    rule_comment = Comment(issue_id=issue["id"], author_id=None, body="Auto-closed")
    session.add(rule_comment)
    session.commit()
    comment = {"id": rule_comment.id}

    for actor in (people["admin"], people["maya"]):
        response = edit(client, actor, comment, "Edited")
        assert response.status_code == 403
        assert response.json()["code"] == "not_your_comment"
    assert delete(client, people["maya"], comment).status_code == 403
    assert delete(client, people["admin"], comment).status_code == 204


def test_deleting_a_comment_deletes_its_files_rows_and_bytes(
    client, session, storage, people, issue
):
    """A comment's files are listed only on the comment. Kept after it, they
    would be files nobody can see or remove."""

    def upload(name):
        response = client.post(
            f"/issues/{issue['id']}/attachments",
            files={"file": (name, io.BytesIO(PNG), "image/png")},
            headers=people["maya"]["headers"],
        )
        assert response.status_code == 200, response.text
        return response.json()

    on_comment = upload("on-comment.png")
    on_issue = upload("on-issue.png")
    comment = post(
        client, people["maya"], issue, "Here", attachment_ids=[on_comment["id"]]
    )
    key = session.get(Attachment, on_comment["id"]).storage_key

    assert delete(client, people["maya"], comment).status_code == 204

    session.expire_all()
    assert session.get(Attachment, on_comment["id"]) is None
    with pytest.raises(ObjectNotFound):
        storage.open(key)
    # The issue's own files are not the comment's to take.
    listed = client.get(
        f"/issues/{issue['id']}/attachments", headers=people["maya"]["headers"]
    ).json()
    assert [a["id"] for a in listed] == [on_issue["id"]]


def test_deleting_a_comment_takes_its_reactions_and_notifications(
    client, session, people, issue
):
    comment = post(client, people["maya"], issue, "over to you @sam")
    client.put(
        f"/comments/{comment['id']}/reactions/eyes", headers=people["sam"]["headers"]
    )
    assert session.exec(
        select(Notification).where(Notification.comment_id == comment["id"])
    ).all()

    assert delete(client, people["maya"], comment).status_code == 204

    assert (
        session.exec(
            select(Notification).where(Notification.comment_id == comment["id"])
        ).all()
        == []
    )
    assert (
        session.exec(
            select(CommentReaction).where(CommentReaction.comment_id == comment["id"])
        ).all()
        == []
    )
    inbox = client.get("/notifications", headers=people["sam"]["headers"]).json()
    assert inbox["items"] == []


def test_the_issue_can_still_be_deleted_after_a_comment_was(client, people, issue):
    """The issue's own delete walks its comments; a gap must not trip it."""
    first = post(client, people["maya"], issue, "one")
    post(client, people["maya"], issue, "two")
    delete(client, people["maya"], first)

    response = client.delete(
        f"/issues/{issue['id']}", headers=people["admin"]["headers"]
    )
    assert response.status_code in (200, 204), response.text

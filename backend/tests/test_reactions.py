"""Emoji reactions on comments (#96)."""

import pytest
from sqlalchemy import event
from sqlmodel import select

from lib_softtrack.comments import list_comments
from lib_softtrack.tables import CommentReaction, Notification, User


def join(client, team, person, role="member"):
    response = client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": person["user"]["email"], "role": role},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text


@pytest.fixture
def thread(client, team, auth):
    """An issue with one comment, and a second member to react alongside."""
    issue = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": "Retry storm"},
        headers=team["headers"],
    ).json()
    comment = client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "Fixed by backing off."},
        headers=team["headers"],
    ).json()
    maya = auth(email="maya@softtrack.dev", full_name="Maya Chen")
    join(client, team, maya)
    return {"issue": issue, "comment": comment, "maya": maya}


def react(client, actor, comment, emoji, method="PUT"):
    return client.request(
        method,
        f"/comments/{comment['id']}/reactions/{emoji}",
        headers=actor["headers"],
    )


def comments(client, actor, issue):
    response = client.get(f"/issues/{issue['id']}/comments", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()["items"]


def test_a_new_comment_has_no_reactions(thread):
    assert thread["comment"]["reactions"] == []


def test_reacting_returns_the_comments_reactions(client, team, thread):
    response = react(client, team, thread["comment"], "thumbs_up")
    assert response.status_code == 200, response.text
    [chip] = response.json()
    assert chip["emoji"] == "thumbs_up"
    assert chip["count"] == 1
    assert chip["reacted"] is True
    assert [u["full_name"] for u in chip["users"]] == ["Demo User"]


def test_reactions_come_back_embedded_in_the_comment_list(client, team, thread):
    react(client, team, thread["comment"], "heart")
    react(client, thread["maya"], thread["comment"], "heart")

    [comment] = comments(client, team, thread["issue"])
    [chip] = comment["reactions"]
    assert chip["count"] == 2
    # In the order they reacted: the tooltip reads as a timeline.
    assert [u["full_name"] for u in chip["users"]] == ["Demo User", "Maya Chen"]


def test_reacted_is_about_whoever_is_asking(client, team, auth, thread):
    react(client, thread["maya"], thread["comment"], "rocket")

    [mine] = comments(client, thread["maya"], thread["issue"])[0]["reactions"]
    [theirs] = comments(client, team, thread["issue"])[0]["reactions"]
    assert mine["reacted"] is True
    assert theirs["reacted"] is False


def test_reacting_twice_is_reacting_once(client, team, thread, session):
    react(client, team, thread["comment"], "eyes")
    response = react(client, team, thread["comment"], "eyes")
    assert response.status_code == 200
    assert response.json()[0]["count"] == 1
    assert len(session.exec(select(CommentReaction)).all()) == 1


def test_one_person_can_give_several_reactions_shown_in_a_fixed_order(
    client, team, thread
):
    # Given in the opposite order to the one they are shown in.
    for emoji in ("eyes", "heart", "thumbs_up"):
        react(client, team, thread["comment"], emoji)

    chips = comments(client, team, thread["issue"])[0]["reactions"]
    assert [chip["emoji"] for chip in chips] == ["thumbs_up", "heart", "eyes"]


def test_taking_a_reaction_back(client, team, thread):
    react(client, team, thread["comment"], "laugh")
    response = react(client, team, thread["comment"], "laugh", method="DELETE")
    assert response.status_code == 200
    assert response.json() == []
    assert comments(client, team, thread["issue"])[0]["reactions"] == []


def test_you_can_only_take_back_your_own(client, team, thread):
    react(client, thread["maya"], thread["comment"], "hooray")
    response = react(client, team, thread["comment"], "hooray", method="DELETE")
    assert response.status_code == 200
    [chip] = response.json()
    assert chip["count"] == 1
    assert chip["users"][0]["full_name"] == "Maya Chen"


def test_taking_back_a_reaction_you_never_gave_is_a_no_op(client, team, thread):
    response = react(client, team, thread["comment"], "confused", method="DELETE")
    assert response.status_code == 200
    assert response.json() == []


def test_only_the_eight_emoji(client, team, thread):
    response = react(client, team, thread["comment"], "party_parrot")
    assert response.status_code == 422


def test_a_missing_comment_is_a_404(client, team):
    response = client.put("/comments/9999/reactions/heart", headers=team["headers"])
    assert response.status_code == 404
    assert response.json()["code"] == "comment_not_found"


def test_outsiders_cannot_react(client, auth, thread):
    stranger = auth(email="stranger@softtrack.dev", full_name="Stranger")
    response = react(client, stranger, thread["comment"], "thumbs_up")
    assert response.status_code == 403
    assert response.json()["code"] == "not_team_member"


def test_guests_see_reactions_but_cannot_react(client, team, auth, thread):
    guest = auth(email="client@example.com", full_name="Carol Client")
    join(client, team, guest, "guest")
    react(client, team, thread["comment"], "heart")

    assert comments(client, guest, thread["issue"])[0]["reactions"][0]["count"] == 1
    response = react(client, guest, thread["comment"], "heart")
    assert response.status_code == 403
    assert response.json()["code"] == "team_read_only"


def test_reacting_notifies_nobody(client, team, thread, session):
    """The whole point: quieter than a comment."""
    # The issue's creator watches it, so a comment from Maya would notify them.
    before = len(session.exec(select(Notification)).all())
    react(client, thread["maya"], thread["comment"], "thumbs_up")
    assert len(session.exec(select(Notification)).all()) == before


def test_an_issue_with_reactions_can_still_be_deleted(client, team, thread, session):
    react(client, team, thread["comment"], "thumbs_up")
    react(client, thread["maya"], thread["comment"], "heart")

    response = client.delete(
        f"/issues/{thread['issue']['id']}", headers=team["headers"]
    )
    assert response.status_code == 204, response.text
    assert session.exec(select(CommentReaction)).all() == []


def test_bulk_delete_clears_reactions_too(client, team, thread, session):
    react(client, team, thread["comment"], "thumbs_up")
    response = client.post(
        f"/teams/{team['team']['id']}/issues/bulk-delete",
        json={"issue_ids": [thread["issue"]["id"]]},
        headers=team["headers"],
    )
    assert response.status_code == 204, response.text
    assert session.exec(select(CommentReaction)).all() == []


def test_reactions_cost_one_query_however_long_the_thread(
    client, team, thread, session
):
    """Embedding them must not make the comment list N+1 again."""
    maya = session.get(User, thread["maya"]["user"]["id"])
    owner = session.get(User, team["user"]["id"])

    def count_queries(n_comments):
        for index in range(n_comments):
            comment = client.post(
                f"/issues/{thread['issue']['id']}/comments",
                json={"body": f"note {index}"},
                headers=team["headers"],
            ).json()
            react(client, thread["maya"], comment, "thumbs_up")
            react(client, team, comment, "heart")
        session.expire_all()
        statements = []
        listener = lambda *args: statements.append(args[2])  # noqa: E731
        engine = session.get_bind()
        event.listen(engine, "before_cursor_execute", listener)
        try:
            page = list_comments(session, owner, thread["issue"]["id"], limit=200)
        finally:
            event.remove(engine, "before_cursor_execute", listener)
        assert all(len(item.reactions) == 2 for item in page.items[1:])
        return len(statements)

    few = count_queries(3)
    many = count_queries(20)
    assert many == few, (few, many)
    assert maya is not None

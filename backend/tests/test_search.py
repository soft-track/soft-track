"""Search across issues and comments (issue #19).

These run on SQLite, which takes the LIKE path. The Postgres path is exercised
against the real stack -- see the PR -- because a tsvector query cannot be
faked on a dialect that has none. The behaviours asserted here (tenancy,
attribution, snippets, paging) are dialect-independent by design.
"""


def make_issue(client, team, title, description=None, **fields):
    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": title, "description": description, **fields},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def find(client, team, q, **params):
    response = client.get("/search", params={"q": q, **params}, headers=team["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def titles(page):
    return [hit["title"] for hit in page["items"]]


# --- what it finds -----------------------------------------------------


def test_it_finds_a_word_in_the_title(client, team):
    make_issue(client, team, "Fix the avatar colour bug")
    make_issue(client, team, "Something else entirely")

    assert titles(find(client, team, "avatar")) == ["Fix the avatar colour bug"]


def test_it_finds_a_word_only_in_the_description(client, team):
    """The old client-side filter could not do this at all."""
    make_issue(client, team, "Opaque title", "The migration deadlocks on startup")

    assert titles(find(client, team, "deadlocks")) == ["Opaque title"]


def test_it_finds_a_word_only_in_a_comment(client, team):
    issue = make_issue(client, team, "Opaque title", "Nothing useful here")
    client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "Turned out to be a stale nginx cache"},
        headers=team["headers"],
    )

    assert titles(find(client, team, "nginx")) == ["Opaque title"]


def test_it_is_case_insensitive(client, team):
    make_issue(client, team, "Fix the Avatar bug")
    assert len(find(client, team, "AVATAR")["items"]) == 1
    assert len(find(client, team, "avatar")["items"]) == 1


def test_it_matches_a_phrase_across_words(client, team):
    make_issue(client, team, "Rate limit the auth endpoints")
    assert len(find(client, team, "limit the auth")["items"]) == 1


def test_an_issue_matching_in_two_places_appears_once(client, team):
    issue = make_issue(client, team, "Cache invalidation", "The cache is stale")
    client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "cache again"},
        headers=team["headers"],
    )

    assert len(find(client, team, "cache")["items"]) == 1


def test_no_matches_is_an_empty_page_not_an_error(client, team):
    make_issue(client, team, "Something")
    page = find(client, team, "nothingmatchesthis")
    assert page["items"] == []
    assert page["total"] == 0


def test_a_blank_query_is_rejected(client, team):
    response = client.get("/search", params={"q": ""}, headers=team["headers"])
    assert response.status_code == 422


# --- where the match was -----------------------------------------------


def test_a_title_match_is_attributed_to_the_title(client, team):
    make_issue(client, team, "Avatar colours", "Some description")
    assert find(client, team, "Avatar")["items"][0]["matched_in"] == "title"


def test_a_description_match_is_attributed_and_snippeted(client, team):
    make_issue(client, team, "Opaque", "The deploy script deletes the volume")
    hit = find(client, team, "volume")["items"][0]

    assert hit["matched_in"] == "description"
    assert "volume" in hit["snippet"]


def test_a_comment_match_says_so(client, team):
    """Otherwise a result whose title has nothing to do with the query
    looks like a bug in the search."""
    issue = make_issue(client, team, "Opaque", "Nothing here")
    client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "the culprit was a stale nginx cache"},
        headers=team["headers"],
    )

    hit = find(client, team, "nginx")["items"][0]
    assert hit["matched_in"] == "comment"
    assert "nginx" in hit["snippet"]


def test_a_snippet_is_a_window_not_the_whole_description(client, team):
    filler = "padding " * 200
    make_issue(client, team, "Opaque", f"{filler} THENEEDLE {filler}")

    hit = find(client, team, "THENEEDLE")["items"][0]
    assert "THENEEDLE" in hit["snippet"]
    assert len(hit["snippet"]) < 400
    assert hit["snippet"].startswith("…") and hit["snippet"].endswith("…")


def test_the_hit_carries_what_a_result_row_needs(client, team):
    make_issue(
        client,
        team,
        "Avatar",
        "x",
        priority="urgent",
        status_id=team["status_ids"]["In Review"],
    )
    hit = find(client, team, "Avatar")["items"][0]

    assert hit["identifier"].startswith("ENG-")
    assert hit["status"]["name"] == "In Review"
    assert hit["priority"] == "urgent"


# --- tenancy -----------------------------------------------------------


def test_it_never_returns_an_issue_from_a_team_you_are_not_in(client, team, auth):
    make_issue(client, team, "Secret roadmap plans")

    outsider = auth(email="outsider@softtrack.dev", full_name="Outsider")
    client.post(
        "/teams", json={"name": "Other", "key": "OTH"}, headers=outsider["headers"]
    )

    response = client.get(
        "/search", params={"q": "roadmap"}, headers=outsider["headers"]
    )
    assert response.json()["items"] == []


def test_it_searches_every_team_you_are_in(client, team, auth):
    make_issue(client, team, "Shared word here")

    second = client.post(
        "/teams", json={"name": "Second", "key": "SEC"}, headers=team["headers"]
    ).json()
    client.post(
        f"/teams/{second['id']}/issues",
        json={"title": "Shared word too"},
        headers=team["headers"],
    )

    assert len(find(client, team, "Shared word")["items"]) == 2


def test_it_can_be_narrowed_to_one_team(client, team, auth):
    make_issue(client, team, "Shared word here")
    second = client.post(
        "/teams", json={"name": "Second", "key": "SEC"}, headers=team["headers"]
    ).json()
    client.post(
        f"/teams/{second['id']}/issues",
        json={"title": "Shared word too"},
        headers=team["headers"],
    )

    page = find(client, team, "Shared word", team_id=second["id"])
    assert titles(page) == ["Shared word too"]


def test_narrowing_to_a_team_you_are_not_in_returns_nothing(client, team, auth):
    """Narrowing can only ever remove teams from the visible set."""
    outsider = auth(email="outsider@softtrack.dev", full_name="Outsider")
    other = client.post(
        "/teams", json={"name": "Other", "key": "OTH"}, headers=outsider["headers"]
    ).json()
    client.post(
        f"/teams/{other['id']}/issues",
        json={"title": "Their secret"},
        headers=outsider["headers"],
    )

    assert find(client, team, "secret", team_id=other["id"])["items"] == []


# --- ranking and paging ------------------------------------------------


def test_a_title_match_outranks_a_comment_match(client, team):
    buried = make_issue(client, team, "Unrelated title", "nothing")
    client.post(
        f"/issues/{buried['id']}/comments",
        json={"body": "mentions webhooks in passing"},
        headers=team["headers"],
    )
    make_issue(client, team, "Webhooks are broken")

    assert titles(find(client, team, "webhooks"))[0] == "Webhooks are broken"


def test_results_are_paginated(client, team):
    for i in range(5):
        make_issue(client, team, f"Paginated match {i}")

    page = find(client, team, "Paginated", limit=2)
    assert len(page["items"]) == 2
    assert page["total"] == 5
    assert page["limit"] == 2

    second = find(client, team, "Paginated", limit=2, offset=2)
    assert len(second["items"]) == 2
    assert {hit["id"] for hit in page["items"]}.isdisjoint(
        {hit["id"] for hit in second["items"]}
    )


def test_a_limit_above_the_maximum_is_rejected(client, team):
    response = client.get(
        "/search", params={"q": "x", "limit": 500}, headers=team["headers"]
    )
    assert response.status_code == 422

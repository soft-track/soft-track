"""Pagination on the collections that can grow without bound."""

import pytest

from lib_softtrack.models.page import DEFAULT_LIMIT, MAX_LIMIT


@pytest.fixture
def many_issues(client, team):
    """12 issues, so a small limit genuinely pages."""
    for n in range(12):
        client.post(
            f"/teams/{team['team']['id']}/issues",
            json={"title": f"issue {n}"},
            headers=team["headers"],
        )
    return team


def test_the_envelope_reports_the_full_total_not_the_page(many_issues, client):
    team = many_issues
    body = client.get(
        f"/teams/{team['team']['id']}/issues?limit=5", headers=team["headers"]
    ).json()
    assert len(body["items"]) == 5
    assert body["total"] == 12  # the point of the envelope
    assert body["limit"] == 5
    assert body["offset"] == 0


def test_offset_walks_the_collection_without_repeating(many_issues, client):
    team = many_issues
    seen = []
    for offset in (0, 5, 10):
        body = client.get(
            f"/teams/{team['team']['id']}/issues?limit=5&offset={offset}",
            headers=team["headers"],
        ).json()
        seen.extend(i["identifier"] for i in body["items"])
    assert len(seen) == 12
    assert len(set(seen)) == 12  # no duplicates, nothing skipped


def test_the_default_limit_applies_when_none_is_given(many_issues, client):
    team = many_issues
    body = client.get(
        f"/teams/{team['team']['id']}/issues", headers=team["headers"]
    ).json()
    assert body["limit"] == DEFAULT_LIMIT


def test_a_limit_above_the_maximum_is_rejected(many_issues, client):
    """The cap is a guard: without it a caller undoes the point of paginating."""
    team = many_issues
    response = client.get(
        f"/teams/{team['team']['id']}/issues?limit={MAX_LIMIT + 1}",
        headers=team["headers"],
    )
    assert response.status_code == 422


def test_a_zero_or_negative_limit_is_rejected(many_issues, client):
    team = many_issues
    for bad in (0, -1):
        response = client.get(
            f"/teams/{team['team']['id']}/issues?limit={bad}", headers=team["headers"]
        )
        assert response.status_code == 422


def test_pagination_composes_with_filters(many_issues, client):
    """total must count what matches the filter, not the whole table."""
    team = many_issues
    client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": "done one", "status": "done"},
        headers=team["headers"],
    )
    body = client.get(
        f"/teams/{team['team']['id']}/issues?status=done&limit=5",
        headers=team["headers"],
    ).json()
    assert body["total"] == 1
    assert [i["title"] for i in body["items"]] == ["done one"]


def test_comments_are_paginated_too(client, team):
    issue = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": "chatty"},
        headers=team["headers"],
    ).json()
    for n in range(7):
        client.post(
            f"/issues/{issue['id']}/comments",
            json={"body": f"comment {n}"},
            headers=team["headers"],
        )
    body = client.get(
        f"/issues/{issue['id']}/comments?limit=3", headers=team["headers"]
    ).json()
    assert len(body["items"]) == 3
    assert body["total"] == 7

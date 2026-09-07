"""Regressions for known, filed bugs.

These are marked xfail(strict=True): they fail today, and the moment someone
fixes the underlying bug pytest reports XPASS as a failure, which is the prompt
to delete the marker. That keeps a fixed bug from quietly losing its test.
"""

import subprocess
import sys
import textwrap

import pytest


@pytest.mark.xfail(
    strict=True,
    reason="soft-track#1: delete_issue drops the Issue row without clearing "
    "IssueLabelLink/Comment first, so the FK blocks it",
)
def test_deleting_an_issue_that_has_a_label(client, team):
    label = client.post(
        f"/teams/{team['team']['id']}/labels",
        json={"name": "Bug", "color": "#e0424a"},
        headers=team["headers"],
    ).json()
    issue = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": "has a label", "label_ids": [label["id"]]},
        headers=team["headers"],
    ).json()

    response = client.delete(f"/issues/{issue['id']}", headers=team["headers"])
    assert response.status_code == 204


@pytest.mark.xfail(
    strict=True,
    reason="soft-track#1: the same FK problem, reached through a comment",
)
def test_deleting_an_issue_that_has_a_comment(client, team):
    issue = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": "has a comment"},
        headers=team["headers"],
    ).json()
    client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "a comment"},
        headers=team["headers"],
    )

    response = client.delete(f"/issues/{issue['id']}", headers=team["headers"])
    assert response.status_code == 204


@pytest.mark.xfail(
    strict=True,
    reason="soft-track#3: register_user picks the avatar with hash(email), and "
    "Python randomises str hashing per process",
)
def test_the_avatar_colour_is_stable_across_processes():
    """Runs in subprocesses on purpose.

    Within one interpreter `hash()` is stable, so a same-process assertion would
    pass and prove nothing. The bug only shows up across runs, which is exactly
    what a user sees when the backend restarts.
    """
    program = textwrap.dedent("""
        from lib_identity.identity import AVATAR_COLORS
        print(AVATAR_COLORS[hash("demo@softtrack.dev") % len(AVATAR_COLORS)])
        """)
    runs = {
        subprocess.run(
            [sys.executable, "-c", program], capture_output=True, text=True, check=True
        ).stdout.strip()
        for _ in range(4)
    }
    assert len(runs) == 1, f"avatar colour differed between runs: {sorted(runs)}"

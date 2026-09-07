"""Regressions for filed bugs.

Tests for bugs that are still open are marked xfail(strict=True): the moment
someone fixes one, pytest reports XPASS as a failure, which is the prompt to
delete the marker. That keeps a fixed bug from quietly losing its test.

soft-track#1 and soft-track#3 are both fixed, so every test here now runs
normally. If a future bug gets a test before it gets a fix, mark that one
xfail(strict=True) and this convention still applies.
"""

import subprocess
import sys
import textwrap

import pytest
from sqlmodel import select

from lib_softtrack.tables import Comment, IssueLabelLink, Label


def test_deleting_an_issue_that_has_a_label(client, team, session):
    """Regression for soft-track#1."""
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

    # the link row must be gone too, not merely orphaned
    assert (
        session.exec(
            select(IssueLabelLink).where(IssueLabelLink.issue_id == issue["id"])
        ).all()
        == []
    )
    # the label itself survives -- it belongs to the team, not the issue
    assert session.get(Label, label["id"]) is not None


def test_deleting_an_issue_that_has_a_comment(client, team, session):
    """Regression for soft-track#1."""
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

    assert (
        session.exec(select(Comment).where(Comment.issue_id == issue["id"])).all() == []
    )


def test_the_avatar_colour_is_stable_across_processes():
    """Regression for soft-track#3."""
    """Runs in subprocesses on purpose.

    Within one interpreter `hash()` is stable, so a same-process assertion would
    pass and prove nothing. The bug only shows up across runs, which is exactly
    what a user sees when the backend restarts.
    """
    program = textwrap.dedent("""
        from lib_identity.identity import avatar_color_for
        print(avatar_color_for("demo@softtrack.dev"))
        """)
    runs = {
        subprocess.run(
            [sys.executable, "-c", program], capture_output=True, text=True, check=True
        ).stdout.strip()
        for _ in range(4)
    }
    assert len(runs) == 1, f"avatar colour differed between runs: {sorted(runs)}"


def test_the_avatar_colour_is_deterministic_and_in_the_palette():
    from lib_identity.identity import AVATAR_COLORS, avatar_color_for

    colour = avatar_color_for("demo@softtrack.dev")
    assert colour in AVATAR_COLORS
    assert colour == avatar_color_for("demo@softtrack.dev")
    # addresses are case- and whitespace-insensitive for this purpose
    assert colour == avatar_color_for("  Demo@SoftTrack.dev  ")

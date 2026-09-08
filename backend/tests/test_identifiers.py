"""Finding issue identifiers in text people wrote for another purpose (issue #25).

The scanner is the piece most likely to be wrong in a way nothing else
notices. Too eager and a pull request links to an issue nobody meant, after
which a rule moves that issue to Done -- so most of these are about what it
must *not* match.
"""

import pytest

from lib_softtrack.identifiers import MAX_SCAN_LENGTH, find_identifiers, resolve

# --- what it finds ---------------------------------------------------------


def test_it_finds_an_identifier_in_a_branch_name():
    assert find_identifiers("eng-42-fix-the-thing") == [("ENG", 42)]


def test_it_is_case_insensitive_because_branch_names_are_lowercase():
    for text in ("ENG-42", "eng-42", "Eng-42"):
        assert find_identifiers(text) == [("ENG", 42)]


def test_it_finds_several_in_the_order_they_are_written():
    assert find_identifiers("ENG-9 and ENG-4 close DES-1") == [
        ("ENG", 9),
        ("ENG", 4),
        ("DES", 1),
    ]


def test_it_deduplicates_across_the_texts_it_is_given():
    # A pull request usually names the issue in its title *and* its branch.
    assert find_identifiers("ENG-42 Fix it", "eng-42-fix-it", "Closes ENG-42") == [
        ("ENG", 42)
    ]


def test_it_reads_through_punctuation_and_line_breaks():
    assert find_identifiers("Closes: ENG-42.\n\nAlso (ENG-43)") == [
        ("ENG", 42),
        ("ENG", 43),
    ]


def test_a_none_text_is_skipped_rather_than_crashing():
    # Payload fields are routinely absent -- a pull request with no body.
    assert find_identifiers(None, "ENG-1", None) == [("ENG", 1)]


# --- what it refuses to find ----------------------------------------------


def test_it_does_not_split_a_longer_number():
    """`ENG-4295` is one identifier. Stopping at `ENG-42` would link a real
    but entirely unrelated issue, which is the worst failure this can have."""
    assert find_identifiers("ENG-4295") == [("ENG", 4295)]


def test_a_key_longer_than_a_team_key_is_not_a_candidate():
    """Team keys are 2-6 characters, so the pattern is exactly that wide."""
    assert find_identifiers("RELEASES-12") == []
    assert find_identifiers("A-1") == []


def test_a_key_must_start_with_a_letter_so_dates_are_not_identifiers():
    assert find_identifiers("2026-09-14") == []


def test_the_false_friends_are_candidates_and_that_is_the_honest_answer():
    """`utf-8` is shaped exactly like an identifier and no pattern can say
    otherwise -- UTF is a perfectly good team key.

    So the scanner does match it, and `resolve` is what makes it harmless:
    see the test below. Asserting the opposite here would be asserting
    something the module cannot do.
    """
    assert find_identifiers("utf-8") == [("UTF", 8)]
    assert find_identifiers("covid-19") == [("COVID", 19)]


def test_an_identifier_glued_to_a_word_is_not_one():
    assert find_identifiers("someENG-42") == []


def test_it_stops_scanning_a_runaway_payload():
    """A signature proves a payload came from the repository, not that it is
    small. The scan is bounded so a huge commit message is cheap."""
    text = ("x" * MAX_SCAN_LENGTH) + " ENG-42"
    assert find_identifiers(text) == []


# --- resolving against a team ---------------------------------------------


@pytest.fixture
def two_teams(client, team, auth):
    """One team's issue, and another team's, to check the boundary holds."""
    other = auth(email="other@softtrack.dev", full_name="Other Person")
    created = client.post(
        "/teams", json={"name": "Design", "key": "DES"}, headers=other["headers"]
    ).json()
    return {**team, "other": other, "other_team": created}


def make_issue(client, actor, team_id, title="Work"):
    response = client.post(
        f"/teams/{team_id}/issues", json={"title": title}, headers=actor["headers"]
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_resolve_finds_the_issue_the_text_names(client, team, session):
    issue = make_issue(client, team, team["team"]["id"])
    found = resolve(session, team["team"]["id"], "eng-1-fix")
    assert [i.id for i in found] == [issue["id"]]


def test_resolve_will_not_cross_a_team_boundary(client, two_teams, session):
    """The security property the whole integration rests on.

    A repository is connected by one team, so a commit message written in that
    repository must not be able to reach another team's board -- however
    deliberately it names it.
    """
    make_issue(client, two_teams, two_teams["team"]["id"])
    theirs = make_issue(
        client, two_teams["other"], two_teams["other_team"]["id"], title="Theirs"
    )

    # Scanning on behalf of team ENG, with text that names a real DES issue.
    found = resolve(session, two_teams["team"]["id"], f"DES-{theirs['number']} done")
    assert found == []


def test_resolve_makes_the_false_friends_harmless(client, team, session):
    """The other half of the scanner being deliberately eager.

    `utf-8` is a candidate identifier; it links nothing, because no team on
    this instance is keyed UTF. That is where the eagerness gets paid for.
    """
    make_issue(client, team, team["team"]["id"])
    assert resolve(session, team["team"]["id"], "encoded as utf-8, sha-1 digest") == []


def test_resolve_ignores_a_number_that_is_not_an_issue(client, team, session):
    make_issue(client, team, team["team"]["id"])
    assert resolve(session, team["team"]["id"], "ENG-999 fixed") == []


def test_resolve_returns_them_in_the_order_the_text_reads(client, team, session):
    first = make_issue(client, team, team["team"]["id"])
    second = make_issue(client, team, team["team"]["id"])
    found = resolve(
        session,
        team["team"]["id"],
        f"Closes ENG-{second['number']} and ENG-{first['number']}",
    )
    assert [i.id for i in found] == [second["id"], first["id"]]

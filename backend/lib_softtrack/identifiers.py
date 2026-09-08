"""Finding issue identifiers in text somebody wrote for another purpose.

This is the whole trick behind the repository integration. Nobody is going to
fill in a "related issue" field on a pull request; they are, however, already
typing `ENG-42` into the branch name, because that is how they find the issue
again. So the link is read out of text that already exists rather than
collected from a form that would go unfilled.

Kept pure and in its own module because it is the piece most likely to be
wrong in a way nothing else notices: a scanner that is slightly too eager
links a pull request to an issue nobody meant, and a rule then moves that
issue to Done. It is worth being able to test on strings alone.
"""

import re
from typing import Iterable

from sqlmodel import Session, select

from lib_softtrack.tables import Issue, Team

#: `ENG-42`, in whatever case somebody typed it.
#:
#: The key shape is not a guess -- `TeamCreate.key` is 2 to 6 characters, so
#: the pattern is exactly what a team key can be and nothing wider. Widening
#: the team key constraint would have to widen this with it.
#:
#: What that does *not* do is exclude the false friends. `utf-8`, `sha-1` and
#: `covid-19` are all shaped exactly like identifiers, and no pattern can tell
#: them apart from one -- `UTF` is a perfectly good team key. The defence is
#: `resolve` below: a candidate becomes a link only if a team on this instance
#: is actually keyed that way *and* has an issue with that number. A team that
#: keys itself UTF and writes "utf-8" in a commit message will link issue 8,
#: and that is inherent to reading identifiers out of prose rather than a bug
#: to pattern-match around.
#:
#: Case-insensitive because branch names are conventionally lowercase:
#: `eng-42-fix-the-thing` is the common spelling and refusing it would mean
#: the feature works for commit messages and not for branches.
#:
#: The trailing boundary is `(?!\d)` rather than `\b` so that `ENG-4295` is one
#: identifier and not `ENG-42` followed by junk -- `\b` would happily stop
#: mid-number and link the wrong issue.
_IDENTIFIER = re.compile(r"(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,5})-(\d{1,9})(?!\d)")

#: Ignore anything past this. A webhook body is attacker-influenced even after
#: the signature checks out -- the signature says the payload came from the
#: repository, not that everything in it is small -- and a regex scan over a
#: megabyte of commit message on every delivery is a free way to spend the
#: worker.
MAX_SCAN_LENGTH = 20_000


def find_identifiers(*texts: str | None) -> list[tuple[str, int]]:
    """Every `(KEY, number)` in these texts, upper-cased and deduplicated.

    Order is preserved -- first mention first -- because it is the order a
    person would read them in, and something has to decide.
    """
    found: list[tuple[str, int]] = []
    seen: set[tuple[str, int]] = set()

    for text in texts:
        if not text:
            continue
        for match in _IDENTIFIER.finditer(text[:MAX_SCAN_LENGTH]):
            key = match.group(1).upper()
            number = int(match.group(2))
            if (key, number) in seen:
                continue
            seen.add((key, number))
            found.append((key, number))

    return found


def resolve(session: Session, team_id: int, *texts: str | None) -> list[Issue]:
    """The issues on this team that these texts name.

    **Scoped to one team, and that is the security boundary.** A repository is
    connected by a team, so text arriving from it can only ever reach that
    team's issues -- a webhook set up by one team cannot move another team's
    board even if somebody writes the other team's identifier in a commit
    message. Resolving globally would be more convenient and would make every
    connected repository a way into every board on the instance.

    An identifier naming a real key and a number that does not exist resolves
    to nothing, silently. There is no useful way to report it: the "caller"
    is a webhook, and the person who mistyped it is looking at a git prompt.
    """
    identifiers = find_identifiers(*texts)
    if not identifiers:
        return []

    team = session.get(Team, team_id)
    if team is None:
        return []

    numbers = [number for key, number in identifiers if key == team.key.upper()]
    if not numbers:
        return []

    issues = session.exec(
        select(Issue).where(Issue.team_id == team_id, Issue.number.in_(numbers))
    ).all()

    # Back into the order the text mentioned them, so a pull request naming
    # two issues links them the way it reads.
    by_number = {issue.number: issue for issue in issues}
    return [by_number[number] for number in _ordered(numbers) if number in by_number]


def _ordered(numbers: Iterable[int]) -> list[int]:
    """First mention first, without duplicates. `find_identifiers` already
    deduplicates, so this only has to preserve what it produced."""
    seen: set[int] = set()
    result: list[int] = []
    for number in numbers:
        if number not in seen:
            seen.add(number)
            result.append(number)
    return result

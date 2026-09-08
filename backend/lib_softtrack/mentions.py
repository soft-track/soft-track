"""Finding the people an `@mention` in a comment or description refers to.

The counterpart of `frontend/src/markdown/mentions.ts` and its remark plugin.
The two have to agree: a handle the renderer turns into a link and this module
does not resolve is a mention that looks delivered and never arrives, and the
reverse is a notification for something nobody can see they wrote.

Only members of the issue's team are resolved. A handle is instance-wide, so
without that check writing `@someone` in a private team's issue would tell a
stranger it exists and what it is called.
"""

import re

from sqlmodel import Session, select

from lib_softtrack.tables import TeamMember, User

#: Mirrors MENTION_PATTERN in frontend/src/markdown/mentions.ts, including the
#: leading boundary that stops `user@example.com` in prose being read as a
#: mention of `@example.com`.
MENTION_PATTERN = re.compile(r"(?:^|[^\w@/])@([a-z0-9][a-z0-9._-]*)", re.IGNORECASE)

#: Fenced blocks, indented-fence blocks and inline spans, longest form first
#: so a ``` fence is not consumed as an empty `` span.
_CODE = re.compile(r"```.*?```|~~~.*?~~~|``.*?``|`[^`\n]*`", re.DOTALL)


def handles_in(text: str | None) -> set[str]:
    """The lowercased handles mentioned in a body of markdown.

    Code is blanked out before the scan for the same reason the renderer
    walks text nodes instead of the raw source: an issue tracker is full of
    shell snippets, and `curl -u @admin` in a fenced block is not a mention of
    anybody. Blanking rather than deleting keeps the boundary character in
    front of the next mention intact.
    """
    if not text:
        return set()
    stripped = _CODE.sub(lambda match: " " * len(match.group()), text)
    return {match.group(1).lower() for match in MENTION_PATTERN.finditer(stripped)}


def mentioned_user_ids(session: Session, team_id: int, text: str | None) -> set[int]:
    """The ids of team members mentioned in `text`.

    One query whatever the number of handles. Deactivated accounts are
    excluded: they cannot read the inbox the notification would land in.
    """
    handles = handles_in(text)
    if not handles:
        return set()

    rows = session.exec(
        select(User.id)
        .join(TeamMember, TeamMember.user_id == User.id)
        .where(
            TeamMember.team_id == team_id,
            User.username.in_(handles),
            User.is_active == True,  # noqa: E712 -- SQL comparison, not a bool test
        )
    ).all()
    return set(rows)

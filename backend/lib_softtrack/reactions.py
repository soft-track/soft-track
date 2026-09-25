"""Emoji reactions on comments (#96).

The quieter alternative to a "+1" comment: a reaction raises no notification,
sends no webhook and runs no automation rule. Saying "agreed" should not ping
everybody watching the issue, and not doing so is the whole reason reactions
exist rather than one more comment.
"""

from collections import defaultdict

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, delete, select

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.comments import ReactionSummary
from lib_softtrack.tables import (
    Comment,
    CommentReaction,
    Issue,
    ReactionEmoji,
    User,
)
from lib_softtrack.teams import require_team_writer
from lib_utils.errors import ErrorCode, api_error

#: The order chips are shown in: the enum's, which is GitHub's.
_ORDER = {emoji: index for index, emoji in enumerate(ReactionEmoji)}


def summaries_for(
    session: Session, comment_ids: list[int], viewer_id: int
) -> dict[int, list[ReactionSummary]]:
    """Every listed comment's reactions, in one query for the whole page."""
    if not comment_ids:
        return {}
    rows = session.exec(
        select(CommentReaction, User)
        .join(User, User.id == CommentReaction.user_id)
        .where(CommentReaction.comment_id.in_(comment_ids))
        .order_by(CommentReaction.created_at, CommentReaction.user_id)
    ).all()

    grouped: dict[int, dict[ReactionEmoji, list[User]]] = defaultdict(dict)
    for reaction, user in rows:
        grouped[reaction.comment_id].setdefault(reaction.emoji, []).append(user)

    return {
        comment_id: [
            ReactionSummary(
                emoji=emoji,
                count=len(users),
                reacted=any(user.id == viewer_id for user in users),
                users=[UserPublic.model_validate(user) for user in users],
            )
            for emoji, users in sorted(by_emoji.items(), key=lambda kv: _ORDER[kv[0]])
        ]
        for comment_id, by_emoji in grouped.items()
    }


def _comment_or_404(session: Session, comment_id: int) -> Comment:
    comment = session.get(Comment, comment_id)
    if comment is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.comment_not_found,
            detail="Comment not found",
        )
    return comment


def _authorised_comment(session: Session, user: User, comment_id: int) -> Comment:
    comment = _comment_or_404(session, comment_id)
    # The route's guard has already done this; repeated here so the service is
    # safe to call from anywhere, which is what a service is for.
    require_team_writer(session.get(Issue, comment.issue_id).team_id, user, session)
    return comment


def add_reaction(
    session: Session, current_user: User, comment_id: int, emoji: ReactionEmoji
) -> list[ReactionSummary]:
    """React, or do nothing if you already had. Returns the comment's reactions."""
    _authorised_comment(session, current_user, comment_id)

    key = (comment_id, current_user.id, emoji)
    if session.get(CommentReaction, key) is None:
        session.add(
            CommentReaction(comment_id=comment_id, user_id=current_user.id, emoji=emoji)
        )
        try:
            session.commit()
        except IntegrityError:
            # The same click arriving twice at once: the other request already
            # inserted the row this one wanted, which is the outcome asked for.
            session.rollback()

    return summaries_for(session, [comment_id], current_user.id).get(comment_id, [])


def remove_reaction(
    session: Session, current_user: User, comment_id: int, emoji: ReactionEmoji
) -> list[ReactionSummary]:
    """Take a reaction back, or do nothing if there was none. Only your own."""
    _authorised_comment(session, current_user, comment_id)

    reaction = session.get(CommentReaction, (comment_id, current_user.id, emoji))
    if reaction is not None:
        session.delete(reaction)
        session.commit()

    return summaries_for(session, [comment_id], current_user.id).get(comment_id, [])


def delete_for_comment(session: Session, comment_id: int) -> None:
    """Remove every reaction on one comment, ahead of the comment (#93)."""
    session.exec(
        delete(CommentReaction).where(CommentReaction.comment_id == comment_id)
    )


def delete_for_issue(session: Session, issue_id: int) -> None:
    """Remove every reaction on an issue's comments, ahead of the comments."""
    session.exec(
        delete(CommentReaction).where(
            CommentReaction.comment_id.in_(
                select(Comment.id).where(Comment.issue_id == issue_id)
            )
        )
    )

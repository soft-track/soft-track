from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app_softtrack.guards import team_writer
from lib_identity.identity import get_current_user
from lib_softtrack import comments as comments_service
from lib_softtrack import reactions as reactions_service
from lib_softtrack.models.comments import CommentCreate, CommentRead, ReactionSummary
from lib_softtrack.models.page import DEFAULT_LIMIT, MAX_LIMIT, Page
from lib_softtrack.tables import ReactionEmoji, User
from web import get_session

router = APIRouter(tags=["comments"])


@router.post(
    "/issues/{issue_id}/comments",
    response_model=CommentRead,
    dependencies=[team_writer],
)
def create_comment(
    issue_id: int,
    payload: CommentCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return comments_service.create_comment(session, current_user, issue_id, payload)


@router.get("/issues/{issue_id}/comments", response_model=Page[CommentRead])
def list_comments(
    issue_id: int,
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return comments_service.list_comments(
        session, current_user, issue_id, limit=limit, offset=offset
    )


@router.put(
    "/comments/{comment_id}/reactions/{emoji}",
    response_model=list[ReactionSummary],
    dependencies=[team_writer],
)
def add_reaction(
    comment_id: int,
    emoji: ReactionEmoji,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """React to a comment. Idempotent: reacting twice is reacting once.

    Returns the comment's reactions as they now stand, so the client can
    redraw the chips without fetching the thread again.
    """
    return reactions_service.add_reaction(session, current_user, comment_id, emoji)


@router.delete(
    "/comments/{comment_id}/reactions/{emoji}",
    response_model=list[ReactionSummary],
    dependencies=[team_writer],
)
def remove_reaction(
    comment_id: int,
    emoji: ReactionEmoji,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Take your own reaction back. Removing one you never gave is a no-op."""
    return reactions_service.remove_reaction(session, current_user, comment_id, emoji)

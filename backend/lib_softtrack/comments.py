"""Comment services."""

from sqlalchemy import func
from sqlmodel import Session, select

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.comments import CommentCreate, CommentRead
from lib_softtrack.models.page import DEFAULT_LIMIT, Page
from lib_softtrack.issues import get_issue_or_404
from lib_softtrack.tables import Comment, User
from lib_softtrack.teams import require_team_member


def _comment_to_read(comment: Comment, author: User) -> CommentRead:
    return CommentRead(
        id=comment.id,
        issue_id=comment.issue_id,
        body=comment.body,
        author=UserPublic.model_validate(author),
        created_at=comment.created_at,
    )


def create_comment(
    session: Session, current_user: User, issue_id: int, payload: CommentCreate
) -> CommentRead:
    issue = get_issue_or_404(session, issue_id)
    require_team_member(issue.team_id, current_user, session)

    comment = Comment(issue_id=issue_id, author_id=current_user.id, body=payload.body)
    session.add(comment)
    session.commit()
    session.refresh(comment)

    return _comment_to_read(comment, current_user)


def list_comments(
    session: Session,
    current_user: User,
    issue_id: int,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
) -> Page[CommentRead]:
    issue = get_issue_or_404(session, issue_id)
    require_team_member(issue.team_id, current_user, session)

    total = session.exec(
        select(func.count()).select_from(Comment).where(Comment.issue_id == issue_id)
    ).one()

    comments = session.exec(
        select(Comment)
        .where(Comment.issue_id == issue_id)
        .order_by(Comment.created_at)
        .offset(offset)
        .limit(limit)
    ).all()

    return Page(
        items=[
            _comment_to_read(comment, session.get(User, comment.author_id))
            for comment in comments
        ],
        total=total,
        limit=limit,
        offset=offset,
    )

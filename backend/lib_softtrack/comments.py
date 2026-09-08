"""Comment services."""

from sqlalchemy import func
from sqlmodel import Session, select

from lib_identity.models.identity import UserPublic
from lib_softtrack import attachments as attachments_service
from lib_softtrack import notifications as notifications_service
from lib_softtrack.models.attachments import AttachmentRead
from lib_softtrack.models.comments import CommentCreate, CommentRead
from lib_softtrack.models.page import DEFAULT_LIMIT, Page
from lib_softtrack.issues import get_issue_or_404
from lib_softtrack.tables import Comment, User
from lib_softtrack.teams import require_team_member


def _comment_to_read(
    comment: Comment,
    author: User,
    attachments: list[AttachmentRead] | None = None,
) -> CommentRead:
    return CommentRead(
        id=comment.id,
        issue_id=comment.issue_id,
        body=comment.body,
        author=UserPublic.model_validate(author),
        attachments=attachments or [],
        created_at=comment.created_at,
    )


def create_comment(
    session: Session, current_user: User, issue_id: int, payload: CommentCreate
) -> CommentRead:
    issue = get_issue_or_404(session, issue_id)
    require_team_member(issue.team_id, current_user, session)

    comment = Comment(issue_id=issue_id, author_id=current_user.id, body=payload.body)
    session.add(comment)
    # Flush rather than commit: the comment needs an id for the attachments to
    # point at, and a failed claim must take the comment down with it rather
    # than leave a comment referring to files it does not own.
    session.flush()
    try:
        attachments_service.claim_for_comment(session, comment, payload.attachment_ids)
        notifications_service.on_comment_created(session, issue, comment, current_user)
        session.commit()
    except Exception:
        # Roll back explicitly rather than leaving it to the session closing.
        # A rejected claim must not leave a flushed comment in the session for
        # the next statement on that connection to commit by accident.
        session.rollback()
        raise
    session.refresh(comment)

    return _comment_to_read(
        comment,
        current_user,
        attachments_service.for_comments(session, [comment.id]).get(comment.id, []),
    )


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

    # One query for the whole page's attachments rather than one per comment.
    by_comment = attachments_service.for_comments(
        session, [comment.id for comment in comments]
    )

    return Page(
        items=[
            _comment_to_read(
                comment,
                session.get(User, comment.author_id),
                by_comment.get(comment.id, []),
            )
            for comment in comments
        ],
        total=total,
        limit=limit,
        offset=offset,
    )

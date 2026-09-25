"""Comment services."""

from sqlalchemy import func
from sqlmodel import Session, select

from lib_identity.models.identity import UserPublic
from lib_softtrack import outbound
from lib_softtrack import attachments as attachments_service
from lib_softtrack import notifications as notifications_service
from lib_softtrack import reactions as reactions_service
from lib_softtrack import rules as rules_service
from lib_softtrack.models.attachments import AttachmentRead
from lib_softtrack.models.comments import (
    CommentCreate,
    CommentRead,
    CommentUpdate,
    ReactionSummary,
)
from lib_softtrack.models.page import DEFAULT_LIMIT, Page
from lib_softtrack.issues import get_issue_or_404
from lib_softtrack.storage import Storage
from lib_softtrack.tables import Comment, Issue, TeamRole, User, WebhookEvent, utcnow
from lib_softtrack.teams import require_team_member, require_team_writer
from lib_utils.errors import ErrorCode, api_error


def _comment_to_read(
    comment: Comment,
    author: User | None,
    attachments: list[AttachmentRead] | None = None,
    reactions: list[ReactionSummary] | None = None,
) -> CommentRead:
    return CommentRead(
        id=comment.id,
        issue_id=comment.issue_id,
        body=comment.body,
        author=UserPublic.model_validate(author) if author else None,
        attachments=attachments or [],
        reactions=reactions or [],
        created_at=comment.created_at,
        edited_at=comment.edited_at,
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
        outbound.emit(
            session,
            issue.team_id,
            WebhookEvent.comment_created,
            lambda: {
                "issue": {
                    "id": issue.id,
                    "number": issue.number,
                    "title": issue.title,
                },
                "comment": {
                    "id": comment.id,
                    "body": comment.body,
                    "created_at": comment.created_at,
                },
            },
            current_user,
        )
        rules_service.on_comment_created(session, issue, current_user)
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
    comment_ids = [comment.id for comment in comments]
    by_comment = attachments_service.for_comments(session, comment_ids)
    # Embedded rather than fetched per comment by the client (#96): the chips
    # render with the comment, and one query covers the whole page.
    reactions = reactions_service.summaries_for(session, comment_ids, current_user.id)

    return Page(
        items=[
            _comment_to_read(
                comment,
                session.get(User, comment.author_id) if comment.author_id else None,
                by_comment.get(comment.id, []),
                reactions.get(comment.id, []),
            )
            for comment in comments
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


def _comment_for_change(
    session: Session, current_user: User, comment_id: int
) -> tuple[Comment, Issue, bool]:
    """The comment, its issue, and whether the caller is a team admin.

    Guests are refused here as well as by the route's guard, so the service is
    safe to call from anywhere.
    """
    comment = session.get(Comment, comment_id)
    if comment is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.comment_not_found,
            detail="Comment not found",
        )
    issue = get_issue_or_404(session, comment.issue_id)
    membership = require_team_writer(issue.team_id, current_user, session)
    return comment, issue, membership.role == TeamRole.admin


def update_comment(
    session: Session, current_user: User, comment_id: int, payload: CommentUpdate
) -> CommentRead:
    """Change a comment's body (#93). Its author's to do, and nobody else's.

    Not even a team admin's: an admin may take a comment down, but words under
    somebody's name should only ever be words they wrote. A comment an
    automation rule posted has no author, so nobody can edit it.
    """
    comment, issue, _ = _comment_for_change(session, current_user, comment_id)
    if comment.author_id is None or comment.author_id != current_user.id:
        raise api_error(
            status_code=403,
            code=ErrorCode.not_your_comment,
            detail="Only the person who wrote this comment can edit it",
        )

    # Saving what is already there is not an edit, and should not say it was.
    if payload.body != comment.body:
        before = comment.body
        comment.body = payload.body
        comment.edited_at = utcnow()
        session.add(comment)
        notifications_service.on_comment_edited(
            session, issue, comment, before, current_user
        )
        session.commit()
        session.refresh(comment)

    return _comment_to_read(
        comment,
        current_user,
        attachments_service.for_comments(session, [comment.id]).get(comment.id, []),
        reactions_service.summaries_for(session, [comment.id], current_user.id).get(
            comment.id, []
        ),
    )


def delete_comment(
    session: Session, storage: Storage, current_user: User, comment_id: int
) -> None:
    """Delete a comment, and everything that was only there because of it (#93).

    Its author may, and so may a team admin -- moderating a thread is part of
    running a team. Its files go with it, rows and bytes: they were posted as
    part of the comment and are listed nowhere else, so keeping them would
    leave files nobody can see or remove. Its reactions and the notifications
    about it go too; all three hold a foreign key to it.
    """
    comment, _, is_admin = _comment_for_change(session, current_user, comment_id)
    if not is_admin and (
        comment.author_id is None or comment.author_id != current_user.id
    ):
        raise api_error(
            status_code=403,
            code=ErrorCode.not_your_comment,
            detail="Only the person who wrote this comment or a team admin can "
            "delete it",
        )

    notifications_service.delete_for_comment(session, comment.id)
    reactions_service.delete_for_comment(session, comment.id)
    storage_keys = attachments_service.take_keys_for_comment(session, comment.id)
    # Flushed before the comment goes, for the reason `delete_issue` gives: no
    # relationship ties these tables together, so nothing else orders the
    # DELETEs, and the comment's must come last.
    session.flush()
    session.delete(comment)
    session.commit()
    # Bytes after the commit: an orphaned file costs disk, a row whose file is
    # gone costs a broken image.
    attachments_service.purge(storage, storage_keys)

"""Parent/child issues, one level deep.

Why one level and not a tree: a tree needs cycle detection on every write, a
recursive query to render, and a rule for what "done" means three levels up.
One level covers breaking a piece of work into pieces -- which is what teams
actually reach for Epic/Story/Sub-task to do -- and the constraint is cheap to
state and cheap to check:

    a parent may not have a parent, and a child may not have children.

Enforcing that pair makes cycles impossible without a graph walk: a cycle of
any length needs every issue in it to have both a parent and a child.
"""

from sqlalchemy import case, func
from sqlmodel import Session, select

from lib_softtrack.statuses import in_category
from lib_softtrack.tables import Issue, StatusCategory
from lib_utils.errors import ErrorCode, api_error

#: A cancelled child is neither done nor outstanding, so it is left out of the
#: count entirely. "3 of 5 done" should not become unreachable because two of
#: the five were cancelled.
#:
#: Categories, not statuses: a team may have several columns that mean done,
#: and may call them anything.
_DONE = StatusCategory.done
_EXCLUDED_FROM_PROGRESS = StatusCategory.cancelled


def validate_parent(session: Session, issue: Issue, parent_id: int) -> Issue:
    """Check that `issue` may be nested under `parent_id`, and return it."""
    if parent_id == issue.id:
        raise api_error(
            status_code=400,
            code=ErrorCode.parent_is_self,
            detail="An issue cannot be its own parent.",
        )

    parent = session.get(Issue, parent_id)
    if parent is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.parent_not_found,
            detail="Parent issue not found",
        )

    if parent.team_id != issue.team_id:
        raise api_error(
            status_code=400,
            code=ErrorCode.parent_other_team,
            detail="A sub-issue must be on the same team as its parent.",
        )

    if parent.parent_id is not None:
        raise api_error(
            status_code=400,
            code=ErrorCode.parent_is_subissue,
            detail=(
                "That issue is already a sub-issue. Sub-issues are one level "
                "deep, so it cannot also be a parent."
            ),
        )

    if issue.id is not None and _has_children(session, issue.id):
        raise api_error(
            status_code=400,
            code=ErrorCode.issue_has_subissues,
            detail=(
                "This issue has sub-issues of its own, so it cannot become a "
                "sub-issue. Move or detach its children first."
            ),
        )

    return parent


def detach_children(session: Session, parent_id: int) -> int:
    """Promote a deleted parent's children to top level.

    Deleting a parent must not delete the work underneath it -- that is a
    lot of data to lose to one click, and the children are usually the part
    worth keeping. They become ordinary top-level issues instead.

    Returns how many were promoted, so the caller can say so.
    """
    children = session.exec(select(Issue).where(Issue.parent_id == parent_id)).all()
    for child in children:
        child.parent_id = None
        session.add(child)
    return len(children)


def child_progress(
    session: Session, parent_ids: list[int]
) -> dict[int, tuple[int, int]]:
    """`{parent_id: (done, total)}`, in one query for the whole page.

    Cancelled children are excluded from both numbers.
    """
    return progress_by(session, Issue.parent_id, parent_ids)


def progress_by(session: Session, column, ids: list[int]) -> dict[int, tuple[int, int]]:
    """`{id: (done, total)}` for issues grouped on `column`, in one query.

    The one definition of progress. A parent's sub-issues and a project's
    issues both count through here, so "what does a cancelled issue count
    as" has one answer -- the one #13 settled -- rather than one per feature.
    An id with no issues is simply absent; callers read that as 0 of 0.
    """
    if not ids:
        return {}

    done_when = case((in_category(_DONE), 1), else_=0)

    rows = session.exec(
        select(column, func.count(), func.coalesce(func.sum(done_when), 0))
        .where(column.in_(ids), ~in_category(_EXCLUDED_FROM_PROGRESS))
        .group_by(column)
    ).all()

    return {key: (int(done), int(total)) for key, total, done in rows}


def _has_children(session: Session, issue_id: int) -> bool:
    return (
        session.exec(select(Issue).where(Issue.parent_id == issue_id)).first()
        is not None
    )

"""Story-point rollups for a team.

Computed in the database rather than by summing the issue list on the client:
the list is paginated, so a client-side total would quietly be the total of
whatever page happened to be loaded. Two grouped queries here cost the same
whether a team has 20 issues or 20,000.
"""

from sqlalchemy import func
from sqlmodel import Session, select

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.estimates import AssigneeLoad, EstimateSummary, StatusLoad
from lib_softtrack.tables import Issue, IssueStatus, User
from lib_softtrack.teams import require_team_member

# COUNT ignores nulls, so counting the column itself counts only the sized
# issues; the unsized ones are the difference from COUNT(*).
_SIZED = func.count(Issue.estimate)
_POINTS = func.coalesce(func.sum(Issue.estimate), 0)
_TOTAL = func.count()


def estimate_summary(
    session: Session, current_user: User, team_id: int
) -> EstimateSummary:
    require_team_member(team_id, current_user, session)

    by_status: dict[IssueStatus, StatusLoad] = {}
    for status, points, total, sized in session.exec(
        select(Issue.status, _POINTS, _TOTAL, _SIZED)
        .where(Issue.team_id == team_id)
        .group_by(Issue.status)
    ).all():
        by_status[status] = StatusLoad(
            points=int(points),
            issue_count=int(total),
            unestimated_count=int(total) - int(sized),
        )

    # Every column, including the empty ones -- a board renders all six, and a
    # missing key would make the client guard at every call site.
    for status in IssueStatus:
        by_status.setdefault(
            status, StatusLoad(points=0, issue_count=0, unestimated_count=0)
        )

    rows = session.exec(
        select(Issue.assignee_id, _POINTS, _TOTAL, _SIZED)
        .where(Issue.team_id == team_id)
        .group_by(Issue.assignee_id)
    ).all()

    users = {
        user.id: user
        for user in session.exec(
            select(User).where(
                User.id.in_([row[0] for row in rows if row[0] is not None])
            )
        ).all()
    }

    by_assignee = [
        AssigneeLoad(
            user=UserPublic.model_validate(users[assignee_id]) if assignee_id else None,
            points=int(points),
            issue_count=int(total),
            unestimated_count=int(total) - int(sized),
        )
        for assignee_id, points, total, sized in rows
    ]
    # Heaviest first, with unassigned work last however big it is -- it is a
    # backlog to distribute, not somebody's load.
    by_assignee.sort(key=lambda load: (load.user is None, -load.points))

    return EstimateSummary(
        total_points=sum(load.points for load in by_status.values()),
        total_issues=sum(load.issue_count for load in by_status.values()),
        unestimated_issues=sum(load.unestimated_count for load in by_status.values()),
        by_status=by_status,
        by_assignee=by_assignee,
    )

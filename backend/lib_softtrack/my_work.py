"""My work (#258): everything that is the viewer's, across every team they
are on.

Signing in used to land on the first team's board, so somebody on three teams
opened three boards and filtered each to themselves. This is the workload tab
(#127) turned round to face its owner, and it shares that tab's query: the
same "open, and on a team the viewer is on" (`workload.open_in_viewers_teams`),
the same per-team totals summed by the database (`workload.team_rollups`), the
same order -- in flight first -- with the due date between it and priority.

Three tabs say whose tickets: assigned to me, the ones I watch, the ones I
created. All three are open work only. What is overdue or due in the next
three days is pulled to the top of Assigned to me, whatever the grouping, and
left out of the groups below it so nothing is listed twice; the team totals
still count it.

Confinement is the usual one, and none of it is repeated here: the trash and
an account from outside are the ORM's (trash.py, outside.py), and teams the
viewer is not on are not in the query. A site admin gets no wider view. Teams
a site admin archived (#307) are left out: nothing is done on them.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func
from sqlmodel import Session, col, select

from lib_identity.models.identity import PersonRef
from lib_identity.models.people import SharedTeam
from lib_softtrack.invites import list_invites_for_user
from lib_softtrack.models.my_work import (
    ActivityKind,
    LastActivity,
    MyWorkCounts,
    MyWorkGrouping,
    MyWorkRead,
    MyWorkTab,
    MyWorkTeam,
    MyWorkTicket,
    WaitingJoinRequest,
    WaitingOnMe,
)
from lib_softtrack.models.page import Page
from lib_softtrack.models.statuses import StatusRead
from lib_softtrack.models.teams import EpicRef
from lib_softtrack.sprints import display_name
from lib_softtrack.tables import (
    Comment,
    Project,
    Sprint,
    Team,
    TeamJoinRequest,
    TeamMember,
    TeamRole,
    Ticket,
    TicketEvent,
    TicketEventField,
    TicketWatch,
    User,
    WorkflowStatus,
    utcnow,
)
from lib_softtrack.workload import (
    CATEGORY_RANK,
    PRIORITY,
    by_team_name,
    open_in_viewers_teams,
    team_rollups,
    teams_by_id,
)

#: "Due soon": from today to this many days ahead. Overdue is anything before.
DUE_SOON_DAYS = 3
#: The most "due soon and overdue" lists. More than this is not a list any
#: more, and the groups below still hold every one of them by team.
DUE_LIMIT = 50

#: In flight first, then by due date -- undated last -- then priority, as the
#: issue orders it. The newest first after that, and the id for a tie across
#: teams.
ORDER = (
    CATEGORY_RANK,
    Ticket.due_date.is_(None),
    Ticket.due_date,
    PRIORITY.desc(),
    Ticket.created_at.desc(),
    Ticket.id.desc(),
)


def _whose(viewer: User, tab: MyWorkTab):
    if tab == MyWorkTab.assigned:
        return Ticket.assignee_id == viewer.id
    if tab == MyWorkTab.created:
        return Ticket.creator_id == viewer.id
    return col(Ticket.id).in_(
        select(TicketWatch.ticket_id).where(
            TicketWatch.user_id == viewer.id,
            TicketWatch.watching == True,  # noqa: E712 -- SQL comparison
        )
    )


def _due_soon(today: date):
    """Overdue or due in the next few days. Open is already in the query, so
    finished work is never here, however late it was finished."""
    return col(Ticket.due_date).is_not(None) & (
        Ticket.due_date <= today + timedelta(days=DUE_SOON_DAYS)
    )


def my_work(
    session: Session,
    viewer: User,
    tab: MyWorkTab = MyWorkTab.assigned,
    grouping: MyWorkGrouping = MyWorkGrouping.team,
    per_team: int = 5,
    team_id: Optional[int] = None,
    offset: int = 0,
    limit: int = 25,
    today: Optional[date] = None,
) -> MyWorkRead:
    today = today or datetime.now(timezone.utc).date()
    visible = open_in_viewers_teams(viewer, archived=False)
    mine = [_whose(viewer, tab), *visible]
    # Only Assigned to me pulls what is due to the top: it is what is mine to
    # do. A ticket I watch or created being late is somebody else's.
    pulled = _due_soon(today) if tab == MyWorkTab.assigned else None
    listed = [*mine, ~pulled] if pulled is not None else mine
    # One team's next page, for its "Show more": nothing else is read.
    one_group = team_id is not None and grouping == MyWorkGrouping.team

    teams: list[MyWorkTeam] = []
    page: Optional[Page[MyWorkTicket]] = None
    if grouping == MyWorkGrouping.team:
        rollups = team_rollups(session, *mine, pulled=pulled)
        by_id = teams_by_id(session, (row[0] for row in rollups))
        for group_team_id, count, points, lifted in by_team_name(rollups, by_id):
            if one_group and group_team_id != team_id:
                continue
            group_offset = offset if one_group else 0
            teams.append(
                MyWorkTeam(
                    team=SharedTeam.model_validate(by_id[group_team_id]),
                    open_count=count,
                    points=points,
                    listed_count=count - lifted,
                    tickets=_rows(
                        session,
                        tab,
                        [*listed, Ticket.team_id == group_team_id],
                        limit=per_team,
                        offset=group_offset,
                    ),
                    offset=group_offset,
                    limit=per_team,
                )
            )
    else:
        total = session.exec(
            select(func.count()).select_from(Ticket).where(*listed)
        ).one()
        page = Page[MyWorkTicket](
            items=_rows(session, tab, listed, limit=limit, offset=offset),
            total=total,
            limit=limit,
            offset=offset,
        )

    if one_group:
        return MyWorkRead(
            tab=tab,
            grouping=grouping,
            counts=MyWorkCounts(assigned=0, watching=0, created=0),
            due=[],
            teams=teams,
            waiting=WaitingOnMe(invites=[], join_requests=[]),
        )
    return MyWorkRead(
        tab=tab,
        grouping=grouping,
        counts=_counts(session, viewer, visible),
        due=(
            _rows(
                session,
                tab,
                [*mine, pulled],
                limit=DUE_LIMIT,
                offset=0,
                order=(Ticket.due_date, PRIORITY.desc(), Ticket.id.desc()),
            )
            if pulled is not None
            else []
        ),
        teams=teams,
        tickets=page,
        waiting=waiting_on(session, viewer),
    )


def _counts(session: Session, viewer: User, visible: list) -> MyWorkCounts:
    def count(tab: MyWorkTab) -> int:
        return session.exec(
            select(func.count())
            .select_from(Ticket)
            .where(_whose(viewer, tab), *visible)
        ).one()

    return MyWorkCounts(
        assigned=count(MyWorkTab.assigned),
        watching=count(MyWorkTab.watching),
        created=count(MyWorkTab.created),
    )


def _rows(
    session: Session,
    tab: MyWorkTab,
    where: list,
    limit: int,
    offset: int,
    order: tuple = ORDER,
) -> list[MyWorkTicket]:
    rows = session.exec(
        select(Ticket, WorkflowStatus, Team, Sprint, Project)
        .join(WorkflowStatus, WorkflowStatus.id == Ticket.status_id)
        .join(Team, Team.id == Ticket.team_id)
        .outerjoin(Sprint, Sprint.id == Ticket.sprint_id)
        .outerjoin(Project, Project.id == Ticket.project_id)
        .where(*where)
        .order_by(*order)
        .limit(limit)
        .offset(offset)
    ).all()
    activity = (
        _last_activity(session, [ticket for ticket, *_ in rows])
        if tab == MyWorkTab.watching
        else {}
    )
    return [
        MyWorkTicket(
            id=ticket.id,
            team_key=team.key,
            number=ticket.number,
            identifier=f"{team.key}-{ticket.number}",
            title=ticket.title,
            status=StatusRead.model_validate(status),
            priority=ticket.priority,
            estimate=ticket.estimate,
            sprint=display_name(sprint) if sprint else None,
            type=ticket.type,
            due_date=ticket.due_date,
            project=EpicRef.model_validate(project) if project else None,
            last_activity=activity.get(ticket.id),
        )
        for ticket, status, team, sprint, project in rows
    ]


def _last_activity(session: Session, tickets: list[Ticket]) -> dict[int, LastActivity]:
    """The latest comment or recorded change on each ticket, in four queries
    whatever the page's size. The values a ticket was created with are not a
    change (`TicketEvent.opening`); a ticket with nothing since was created."""
    ids = [ticket.id for ticket in tickets]
    if not ids:
        return {}
    events = {
        event.ticket_id: event
        for event in session.exec(
            select(TicketEvent).where(
                col(TicketEvent.id).in_(
                    select(func.max(TicketEvent.id))
                    .where(
                        col(TicketEvent.ticket_id).in_(ids),
                        TicketEvent.opening == False,  # noqa: E712
                    )
                    .group_by(TicketEvent.ticket_id)
                )
            )
        ).all()
    }
    comments = {
        comment.ticket_id: comment
        for comment in session.exec(
            select(Comment).where(
                col(Comment.id).in_(
                    select(func.max(Comment.id))
                    .where(col(Comment.ticket_id).in_(ids))
                    .group_by(Comment.ticket_id)
                )
            )
        ).all()
    }
    assignees = {
        int(event.new_value)
        for event in events.values()
        if event.field == TicketEventField.assignee
        and event.new_value
        and event.new_value.isdigit()
    }
    people_ids = (
        {event.actor_id for event in events.values()}
        | {comment.author_id for comment in comments.values()}
        | {ticket.creator_id for ticket in tickets}
        | assignees
    ) - {None}
    people = {
        user.id: user
        for user in session.exec(select(User).where(col(User.id).in_(people_ids))).all()
    }

    def person(user_id: Optional[int]) -> Optional[PersonRef]:
        user = people.get(user_id)
        return PersonRef.model_validate(user) if user else None

    latest: dict[int, LastActivity] = {}
    for ticket in tickets:
        event, comment = events.get(ticket.id), comments.get(ticket.id)
        if comment and (event is None or comment.created_at >= event.created_at):
            latest[ticket.id] = LastActivity(
                kind=ActivityKind.commented,
                actor=person(comment.author_id),
                at=comment.created_at,
            )
        elif event:
            assignee = (
                people.get(int(event.new_value))
                if event.field == TicketEventField.assignee
                and event.new_value
                and event.new_value.isdigit()
                else None
            )
            latest[ticket.id] = LastActivity(
                kind=ActivityKind.changed,
                field=event.field,
                new_label=assignee.full_name if assignee else None,
                actor=person(event.actor_id),
                at=event.created_at,
            )
        else:
            latest[ticket.id] = LastActivity(
                kind=ActivityKind.created,
                actor=person(ticket.creator_id),
                at=ticket.created_at,
            )
    return latest


def waiting_on(session: Session, viewer: User) -> WaitingOnMe:
    """Invitations to the viewer, and requests to join a team they run that
    is still in use. Each request is the team's admins' to decide, so it waits
    on every one of them."""
    admin_of = select(TeamMember.team_id).where(
        TeamMember.user_id == viewer.id, TeamMember.role == TeamRole.admin
    )
    requests = session.exec(
        select(TeamJoinRequest, Team, User)
        .join(Team, Team.id == TeamJoinRequest.team_id)
        .join(User, User.id == TeamJoinRequest.requester_id)
        .where(
            col(TeamJoinRequest.team_id).in_(admin_of),
            Team.archived_at == None,  # noqa: E711 -- SQL IS NULL
            User.is_active == True,  # noqa: E712 -- SQL comparison
            TeamJoinRequest.expires_at > utcnow(),
        )
        .order_by(TeamJoinRequest.created_at, TeamJoinRequest.id)
    ).all()
    return WaitingOnMe(
        invites=list_invites_for_user(session, viewer),
        join_requests=[
            WaitingJoinRequest(
                id=request.id,
                team=SharedTeam.model_validate(team),
                requester=PersonRef.model_validate(requester),
                created_at=request.created_at,
            )
            for request, team, requester in requests
        ],
    )

"""Saved views: named filter sets over a team's issues, and where you land.

Two things live here that are easy to get wrong separately and easy to keep
straight together:

**Who can see a view.** A view is private to its owner until it is shared,
after which the whole team has it. Every read goes through `_visible_to`, so
there is one definition of "yours or the team's" rather than one per endpoint.

**Where the board opens.** A team has a default, and a person may override it
for themselves. `_resolve_default` is the only place that precedence is
expressed; the client is told the answer rather than the rule.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlmodel import Session, or_, select

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.views import (
    DefaultViewUpdate,
    SavedViewCreate,
    SavedViewRead,
    SavedViews,
    SavedViewUpdate,
    ViewFilters,
)
from lib_softtrack.tables import (
    Cycle,
    Label,
    Project,
    SavedView,
    Team,
    TeamMember,
    User,
    UserDefaultView,
)
from lib_softtrack.teams import (
    get_team_or_404,
    require_team_admin,
    require_team_member,
)


def _to_read(view: SavedView, owner: User) -> SavedViewRead:
    return SavedViewRead(
        id=view.id,
        team_id=view.team_id,
        name=view.name,
        owner=UserPublic.model_validate(owner),
        is_shared=view.is_shared,
        filters=ViewFilters(
            status=view.status,
            priority=view.priority,
            assignee_id=view.assignee_id,
            unassigned=view.unassigned,
            label_id=view.label_id,
            project_id=view.project_id,
            cycle_id=view.cycle_id,
        ),
        created_at=view.created_at,
        updated_at=view.updated_at,
    )


def _apply_filters(view: SavedView, filters: ViewFilters) -> None:
    view.status = filters.status
    view.priority = filters.priority
    view.assignee_id = filters.assignee_id
    view.unassigned = filters.unassigned
    view.label_id = filters.label_id
    view.project_id = filters.project_id
    view.cycle_id = filters.cycle_id


def _validate_filters(session: Session, team_id: int, filters: ViewFilters) -> None:
    """Reject a filter pointing at something outside this team.

    Without this a view could be saved against another team's label and would
    then match nothing for ever, looking like a bug in filtering rather than a
    bad reference. Checked on write, once, rather than on every read.
    """
    if filters.label_id is not None:
        label = session.get(Label, filters.label_id)
        if label is None or label.team_id != team_id:
            raise HTTPException(status_code=400, detail="No such label on this team")
    if filters.project_id is not None:
        project = session.get(Project, filters.project_id)
        if project is None or project.team_id != team_id:
            raise HTTPException(status_code=400, detail="No such project on this team")
    if filters.cycle_id is not None:
        cycle = session.get(Cycle, filters.cycle_id)
        if cycle is None or cycle.team_id != team_id:
            raise HTTPException(status_code=400, detail="No such cycle on this team")
    if filters.assignee_id is not None:
        member = session.exec(
            select(TeamMember).where(
                TeamMember.team_id == team_id,
                TeamMember.user_id == filters.assignee_id,
            )
        ).first()
        if member is None:
            raise HTTPException(
                status_code=400, detail="That person is not on this team"
            )


def _visible_to(user: User, team_id: int):
    """The filter clause for "views this person may see on this team"."""
    return (
        SavedView.team_id == team_id,
        or_(
            SavedView.is_shared == True,  # noqa: E712 -- SQL comparison
            SavedView.owner_id == user.id,
        ),
    )


def get_view_or_404(session: Session, current_user: User, view_id: int) -> SavedView:
    """A view the caller is allowed to know exists.

    404 rather than 403 for somebody else's private view: the name of a view
    is the sort of thing that leaks what a team is working on, and "you may
    not see this one" says it exists.
    """
    view = session.get(SavedView, view_id)
    if view is None:
        raise HTTPException(status_code=404, detail="View not found")
    require_team_member(view.team_id, current_user, session)
    if not view.is_shared and view.owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="View not found")
    return view


def _require_can_edit(session: Session, current_user: User, view: SavedView) -> None:
    """Its owner, or an admin of the team.

    Admins included so a shared view does not become permanent when the person
    who made it leaves -- somebody has to be able to tidy up.
    """
    if view.owner_id == current_user.id:
        return
    require_team_admin(view.team_id, current_user, session)


def _resolve_default(
    session: Session, current_user: User, team: Team
) -> tuple[Optional[int], Optional[int]]:
    """`(my override, what the board should open on)`.

    An override is dropped rather than honoured if it points at a view that
    has since been deleted or unshared out of reach -- the person would
    otherwise land on nothing at all.
    """
    override = session.get(UserDefaultView, (current_user.id, team.id))
    my_default_id = None
    if override is not None:
        view = session.get(SavedView, override.view_id)
        if view is not None and (view.is_shared or view.owner_id == current_user.id):
            my_default_id = view.id

    effective = my_default_id if my_default_id is not None else team.default_view_id
    return my_default_id, effective


def list_views(session: Session, current_user: User, team_id: int) -> SavedViews:
    team = get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)

    rows = session.exec(
        select(SavedView, User)
        .join(User, User.id == SavedView.owner_id)
        .where(*_visible_to(current_user, team_id))
        # Shared before private, then alphabetical: the sidebar reads as "what
        # the team looks at" before "what I look at".
        .order_by(SavedView.is_shared.desc(), SavedView.name)
    ).all()

    my_default_id, effective = _resolve_default(session, current_user, team)

    return SavedViews(
        items=[_to_read(view, owner) for view, owner in rows],
        team_default_id=team.default_view_id,
        my_default_id=my_default_id,
        effective_default_id=effective,
    )


def create_view(
    session: Session, current_user: User, team_id: int, payload: SavedViewCreate
) -> SavedViewRead:
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    _validate_filters(session, team_id, payload.filters)

    view = SavedView(
        team_id=team_id,
        name=payload.name.strip(),
        owner_id=current_user.id,
        is_shared=payload.is_shared,
    )
    _apply_filters(view, payload.filters)
    session.add(view)
    session.commit()
    session.refresh(view)
    return _to_read(view, current_user)


def update_view(
    session: Session, current_user: User, view_id: int, payload: SavedViewUpdate
) -> SavedViewRead:
    view = get_view_or_404(session, current_user, view_id)
    _require_can_edit(session, current_user, view)

    if payload.name is not None:
        view.name = payload.name.strip()
    if payload.filters is not None:
        _validate_filters(session, view.team_id, payload.filters)
        _apply_filters(view, payload.filters)
    if payload.is_shared is not None and payload.is_shared != view.is_shared:
        view.is_shared = payload.is_shared
        if not view.is_shared:
            _withdraw_from_defaults(session, view, keep_owner=True)

    view.updated_at = datetime.now(timezone.utc)
    session.add(view)
    session.commit()
    session.refresh(view)
    return _to_read(view, session.get(User, view.owner_id))


def _withdraw_from_defaults(
    session: Session, view: SavedView, keep_owner: bool = False
) -> None:
    """Stop pointing at a view that is about to stop being reachable.

    Un-sharing or deleting one has to take the team's default and everybody's
    override with it, or the next person to open the board lands on a view
    they cannot see. `keep_owner` is for un-sharing: the owner can still see
    it, so their own override survives.
    """
    team = session.get(Team, view.team_id)
    if team is not None and team.default_view_id == view.id:
        team.default_view_id = None
        session.add(team)

    for override in session.exec(
        select(UserDefaultView).where(UserDefaultView.view_id == view.id)
    ).all():
        if keep_owner and override.user_id == view.owner_id:
            continue
        session.delete(override)
    session.flush()


def delete_view(session: Session, current_user: User, view_id: int) -> None:
    view = get_view_or_404(session, current_user, view_id)
    _require_can_edit(session, current_user, view)

    # Before the row goes: both of these hold a foreign key to it.
    _withdraw_from_defaults(session, view)
    session.delete(view)
    session.commit()


def set_team_default(
    session: Session, current_user: User, team_id: int, payload: DefaultViewUpdate
) -> SavedViews:
    """Point the whole team at one view. Admins only, and shared views only."""
    team = get_team_or_404(team_id, session)
    require_team_admin(team_id, current_user, session)

    if payload.view_id is None:
        team.default_view_id = None
    else:
        view = get_view_or_404(session, current_user, payload.view_id)
        if view.team_id != team_id:
            raise HTTPException(status_code=400, detail="That view is another team's")
        if not view.is_shared:
            raise HTTPException(
                status_code=400,
                detail="A private view cannot be the team default; share it first.",
            )
        team.default_view_id = view.id

    session.add(team)
    session.commit()
    return list_views(session, current_user, team_id)


def set_my_default(
    session: Session, current_user: User, team_id: int, payload: DefaultViewUpdate
) -> SavedViews:
    """Choose where the board opens, for yourself, overriding the team's."""
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)

    existing = session.get(UserDefaultView, (current_user.id, team_id))

    if payload.view_id is None:
        # Removing the override falls back to the team's default rather than
        # to "all issues" -- "no preference" is what the row's absence means.
        if existing is not None:
            session.delete(existing)
    else:
        view = get_view_or_404(session, current_user, payload.view_id)
        if view.team_id != team_id:
            raise HTTPException(status_code=400, detail="That view is another team's")
        if existing is None:
            session.add(
                UserDefaultView(
                    user_id=current_user.id, team_id=team_id, view_id=view.id
                )
            )
        else:
            existing.view_id = view.id
            session.add(existing)

    session.commit()
    return list_views(session, current_user, team_id)


def clear_cycle(session: Session, cycle_id: int) -> None:
    """Drop a deleted cycle from every view that filtered on it.

    Called from the cycle service. A view left pointing at a cycle that no
    longer exists matches nothing, which reads as a broken filter rather than
    an empty one.
    """
    for view in session.exec(
        select(SavedView).where(SavedView.cycle_id == cycle_id)
    ).all():
        view.cycle_id = None
        session.add(view)

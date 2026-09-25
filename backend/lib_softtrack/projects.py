"""Project services.

A project is what SoftTrack calls an epic -- see `tables.Project`.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from lib_softtrack import automations as automations_service
from lib_softtrack import views as views_service
from lib_softtrack.models.projects import ProjectCreate, ProjectUpdate
from lib_softtrack.tables import Issue, Project, TeamMember, User
from lib_softtrack.teams import get_team_or_404, require_team_member

#: Fields that mean "no value" when sent as null, as opposed to the rest of
#: ProjectUpdate, where null only ever means "not sent".
_CLEARABLE = {"lead_id", "target_date", "description"}


def _require_lead_in_team(
    session: Session, team_id: int, lead_id: Optional[int]
) -> None:
    """A lead from outside the team could not see the project they lead."""
    if lead_id is None:
        return
    membership = session.exec(
        select(TeamMember).where(
            TeamMember.team_id == team_id, TeamMember.user_id == lead_id
        )
    ).first()
    if membership is None:
        raise HTTPException(
            status_code=422, detail="The lead must be a member of the team."
        )


def get_project_or_404(session: Session, project_id: int) -> Project:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def create_project(
    session: Session, current_user: User, team_id: int, payload: ProjectCreate
) -> Project:
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    _require_lead_in_team(session, team_id, payload.lead_id)

    project = Project(team_id=team_id, **payload.model_dump())
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


def list_projects(session: Session, current_user: User, team_id: int) -> list[Project]:
    """Every project, archived ones included.

    Archived projects stay in the list because issues still point at them and
    need a name to show. Leaving them out of *pickers* is the client's call,
    made by reading `archived`.
    """
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    return session.exec(select(Project).where(Project.team_id == team_id)).all()


def get_project(session: Session, current_user: User, project_id: int) -> Project:
    project = get_project_or_404(session, project_id)
    require_team_member(project.team_id, current_user, session)
    return project


def update_project(
    session: Session, current_user: User, project_id: int, payload: ProjectUpdate
) -> Project:
    project = get_project_or_404(session, project_id)
    require_team_member(project.team_id, current_user, session)

    data = payload.model_dump(exclude_unset=True)
    # A null for anything outside _CLEARABLE is "not sent" said badly, not a
    # request to blank a NOT NULL column.
    data = {k: v for k, v in data.items() if v is not None or k in _CLEARABLE}
    if "lead_id" in data:
        _require_lead_in_team(session, project.team_id, data["lead_id"])

    for field, value in data.items():
        setattr(project, field, value)
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


def delete_project(session: Session, current_user: User, project_id: int) -> None:
    """Delete a project, keeping every issue that was in it.

    The issues are the work; the project was only a way of grouping it. They
    are released back to "no project" -- the same answer #13 gives a parent's
    sub-issues -- rather than deleted along with it. Archiving is the gentler
    option and the one the UI offers first; this is for a project that should
    never have existed.
    """
    project = get_project_or_404(session, project_id)
    require_team_member(project.team_id, current_user, session)

    now = datetime.now(timezone.utc)
    for issue in session.exec(select(Issue).where(Issue.project_id == project_id)):
        issue.project_id = None
        issue.updated_at = now
        session.add(issue)

    # A view left filtering on a project that no longer exists matches
    # nothing, which reads as broken rather than empty.
    views_service.clear_project(session, project_id)
    # A rule conditioned on it is switched off -- see automations.clear_project.
    automations_service.clear_project(session, project_id)
    session.flush()

    session.delete(project)
    session.commit()

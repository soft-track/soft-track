"""Project services.

A project is what SoftTrack calls an epic -- see `tables.Project`.
"""

from typing import Optional

from sqlmodel import Session, select

from lib_softtrack.models.projects import ProjectCreate, ProjectRead, ProjectUpdate
from lib_softtrack.subtickets import progress_by
from lib_softtrack.tables import Ticket, Project, TeamMember, User
from lib_softtrack.teams import get_team_or_404, require_team_member
from lib_utils.errors import ErrorCode, api_error

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
        raise api_error(
            status_code=422,
            code=ErrorCode.user_not_on_team,
            detail="The lead must be a member of the team.",
        )


def projects_to_read(session: Session, projects: list[Project]) -> list[ProjectRead]:
    """Projects with their progress, in one query however many there are.

    The roadmap and the sidebar read every project's progress at once, and a
    count per project would be one query per row.
    """
    progress = progress_by(session, Ticket.project_id, [p.id for p in projects])
    reads = []
    for project in projects:
        done, total = progress.get(project.id, (0, 0))
        reads.append(
            ProjectRead(
                **project.model_dump(), ticket_count=total, completed_ticket_count=done
            )
        )
    return reads


def project_to_read(session: Session, project: Project) -> ProjectRead:
    return projects_to_read(session, [project])[0]


def get_project_or_404(session: Session, project_id: int) -> Project:
    project = session.get(Project, project_id)
    if not project:
        raise api_error(
            status_code=404,
            code=ErrorCode.project_not_found,
            detail="Project not found",
        )
    return project


def create_project(
    session: Session, current_user: User, team_id: int, payload: ProjectCreate
) -> ProjectRead:
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    _require_lead_in_team(session, team_id, payload.lead_id)

    project = Project(team_id=team_id, **payload.model_dump())
    session.add(project)
    session.commit()
    session.refresh(project)
    return project_to_read(session, project)


def list_projects(
    session: Session, current_user: User, team_id: int
) -> list[ProjectRead]:
    """Every project, archived ones included.

    Archived projects stay in the list because tickets still point at them and
    need a name to show. Leaving them out of *pickers* is the client's call,
    made by reading `archived`.
    """
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    projects = session.exec(select(Project).where(Project.team_id == team_id)).all()
    return projects_to_read(session, list(projects))


def get_project(session: Session, current_user: User, project_id: int) -> ProjectRead:
    project = get_project_or_404(session, project_id)
    require_team_member(project.team_id, current_user, session)
    return project_to_read(session, project)


def update_project(
    session: Session, current_user: User, project_id: int, payload: ProjectUpdate
) -> ProjectRead:
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
    return project_to_read(session, project)

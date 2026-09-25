"""Issue description templates (#97).

A team admin keeps a short list -- "Bug report", "Feature request" -- and the
new-issue form offers them. Choosing one fills the description; it is a
prefill, not a form, so everything after that is ordinary editing. Teams opt
in by writing their own: nothing is seeded, because a template nobody on the
team wrote is one nobody on the team fills in.
"""

from typing import Optional

from sqlmodel import Session, select

from lib_softtrack.models.templates import (
    IssueTemplateCreate,
    IssueTemplateOrder,
    IssueTemplateRead,
    IssueTemplateUpdate,
)
from lib_softtrack.tables import IssueTemplate, User, utcnow
from lib_softtrack.teams import get_team_or_404, require_team_admin, require_team_member
from lib_utils.errors import ErrorCode, api_error


def _team_templates(session: Session, team_id: int) -> list[IssueTemplate]:
    return session.exec(
        select(IssueTemplate)
        .where(IssueTemplate.team_id == team_id)
        .order_by(IssueTemplate.position, IssueTemplate.id)
    ).all()


def _read_all(session: Session, team_id: int) -> list[IssueTemplateRead]:
    return [
        IssueTemplateRead.model_validate(template)
        for template in _team_templates(session, team_id)
    ]


def _template_or_404(session: Session, template_id: int) -> IssueTemplate:
    template = session.get(IssueTemplate, template_id)
    if template is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.template_not_found,
            detail="Template not found",
        )
    return template


def _clean(value: str, field: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise api_error(
            status_code=400,
            code=(
                ErrorCode.name_required if field == "name" else ErrorCode.body_required
            ),
            detail=f"A template needs a {field}",
        )
    return cleaned


def _assert_name_free(
    session: Session, team_id: int, name: str, except_id: Optional[int] = None
) -> None:
    # Case-insensitively: "Bug report" and "bug report" side by side in a
    # picker is two entries somebody will choose between by guessing.
    statement = select(IssueTemplate.id, IssueTemplate.name).where(
        IssueTemplate.team_id == team_id
    )
    for template_id, existing in session.exec(statement).all():
        if template_id != except_id and existing.casefold() == name.casefold():
            raise api_error(
                status_code=400,
                code=ErrorCode.template_name_taken,
                detail="This team already has a template with that name",
            )


def list_templates(
    session: Session, current_user: User, team_id: int
) -> list[IssueTemplateRead]:
    """Any member may read them -- they are what the new-issue form offers."""
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    return _read_all(session, team_id)


def create_template(
    session: Session, current_user: User, team_id: int, payload: IssueTemplateCreate
) -> IssueTemplateRead:
    get_team_or_404(team_id, session)
    # Admin-only: a template decides what every issue on the team starts as.
    require_team_admin(team_id, current_user, session)

    name = _clean(payload.name, "name")
    _assert_name_free(session, team_id, name)
    existing = _team_templates(session, team_id)
    template = IssueTemplate(
        team_id=team_id,
        name=name,
        body=_clean(payload.body, "body"),
        # Appended; the admin can drag it.
        position=(existing[-1].position + 1) if existing else 0,
    )
    session.add(template)
    session.commit()
    session.refresh(template)
    return IssueTemplateRead.model_validate(template)


def update_template(
    session: Session, current_user: User, template_id: int, payload: IssueTemplateUpdate
) -> IssueTemplateRead:
    template = _template_or_404(session, template_id)
    require_team_admin(template.team_id, current_user, session)

    if payload.name is not None:
        name = _clean(payload.name, "name")
        _assert_name_free(session, template.team_id, name, except_id=template.id)
        template.name = name
    if payload.body is not None:
        template.body = _clean(payload.body, "body")
    template.updated_at = utcnow()

    session.add(template)
    session.commit()
    session.refresh(template)
    return IssueTemplateRead.model_validate(template)


def reorder_templates(
    session: Session, current_user: User, team_id: int, payload: IssueTemplateOrder
) -> list[IssueTemplateRead]:
    get_team_or_404(team_id, session)
    require_team_admin(team_id, current_user, session)

    templates = _team_templates(session, team_id)
    if sorted(payload.template_ids) != sorted(t.id for t in templates):
        # A stale list: somebody else added or removed one meanwhile.
        raise api_error(
            status_code=400,
            code=ErrorCode.template_order_incomplete,
            detail="Reordering takes every template on the team, exactly once",
        )
    by_id = {template.id: template for template in templates}
    for position, template_id in enumerate(payload.template_ids):
        by_id[template_id].position = position
        session.add(by_id[template_id])
    session.commit()
    return _read_all(session, team_id)


def delete_template(session: Session, current_user: User, template_id: int) -> None:
    """Gone from the picker. Issues already filed from it keep their text."""
    template = _template_or_404(session, template_id)
    require_team_admin(template.team_id, current_user, session)
    session.delete(template)
    session.commit()

"""Label services: a team's own tags, named once and pointed at by tickets.

Tickets, saved views and automation rules all point at the row, not the
name, which is what makes renaming one a single change that every ticket
follows (#321). Names are unique on a team whatever the case, the way
department names are, so "feature" cannot join "Feature".
"""

from typing import Optional

from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from lib_softtrack.models.labels import LabelCreate, LabelUpdate, LabelUsage, NamedRef
from lib_softtrack.tables import (
    AutomationRule,
    Label,
    SavedView,
    TicketLabelLink,
    User,
    label_name_key,
)
from lib_softtrack.teams import (
    get_team_or_404,
    require_team_admin,
    require_team_member,
)
from lib_utils.errors import ErrorCode, api_error


def _label_or_404(session: Session, label_id: int) -> Label:
    label = session.get(Label, label_id)
    if label is None:
        raise api_error(
            status_code=404, code=ErrorCode.label_not_found, detail="Label not found"
        )
    return label


def _required_name(name: str) -> str:
    name = name.strip()
    if not name:
        raise api_error(
            status_code=400,
            code=ErrorCode.name_required,
            detail="A label needs a name",
        )
    return name


def _assert_name_free(
    session: Session, team_id: int, name: str, except_id: Optional[int] = None
) -> None:
    """Refuse a name another of the team's labels has, in any case."""
    statement = select(Label).where(
        Label.team_id == team_id, Label.name_key == label_name_key(name)
    )
    if except_id is not None:
        statement = statement.where(Label.id != except_id)
    existing = session.exec(statement).first()
    if existing is not None:
        raise api_error(
            status_code=400,
            code=ErrorCode.label_name_taken,
            detail=f"“{name}” is taken by {existing.name}. Label names are "
            "unique, whatever the case.",
        )


def _commit_name(
    session: Session, team_id: int, name: str, except_id: Optional[int] = None
) -> None:
    """Commit a new or renamed label, naming the clash if it lost a race.

    The check before it covers the ordinary case; two people adding the same
    name at once both pass it, and the unique key refuses the second.
    """
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        _assert_name_free(session, team_id, name, except_id=except_id)
        raise


def create_label(
    session: Session, current_user: User, team_id: int, payload: LabelCreate
) -> Label:
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    name = _required_name(payload.name)
    _assert_name_free(session, team_id, name)

    label = Label(team_id=team_id, name=name, color=payload.color)
    session.add(label)
    _commit_name(session, team_id, name)
    session.refresh(label)
    return label


def list_labels(session: Session, current_user: User, team_id: int) -> list[Label]:
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    return session.exec(
        select(Label).where(Label.team_id == team_id).order_by(Label.id)
    ).all()


def update_label(
    session: Session, current_user: User, label_id: int, payload: LabelUpdate
) -> Label:
    """Rename or recolour a label. Every ticket carrying it follows."""
    label = _label_or_404(session, label_id)
    require_team_member(label.team_id, current_user, session)

    name = label.name
    if payload.name is not None:
        name = _required_name(payload.name)
        _assert_name_free(session, label.team_id, name, except_id=label.id)
        label.name = name
    if payload.color is not None:
        label.color = payload.color
    session.add(label)
    _commit_name(session, label.team_id, name, except_id=label.id)
    session.refresh(label)
    return label


def label_usage(session: Session, current_user: User, team_id: int) -> list[LabelUsage]:
    """How many tickets carry each of the team's labels, and which saved views
    and automation rules name it. Three queries, however many labels."""
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    label_ids = session.exec(select(Label.id).where(Label.team_id == team_id)).all()

    counts = dict(
        session.exec(
            select(TicketLabelLink.label_id, func.count())
            .where(TicketLabelLink.label_id.in_(label_ids))
            .group_by(TicketLabelLink.label_id)
        ).all()
    )
    views: dict[int, list[NamedRef]] = {}
    hidden: dict[int, int] = {}
    for view in session.exec(
        select(SavedView)
        .where(SavedView.label_id.in_(label_ids))
        .order_by(SavedView.name)
    ).all():
        if view.is_shared or view.owner_id == current_user.id:
            views.setdefault(view.label_id, []).append(
                NamedRef(id=view.id, name=view.name)
            )
        else:
            hidden[view.label_id] = hidden.get(view.label_id, 0) + 1
    rules: dict[int, list[NamedRef]] = {}
    for rule in session.exec(
        select(AutomationRule)
        .where(
            or_(
                AutomationRule.if_label_id.in_(label_ids),
                AutomationRule.add_label_id.in_(label_ids),
            )
        )
        .order_by(AutomationRule.name)
    ).all():
        # Once per label, even for a rule naming it twice.
        for label_id in {rule.if_label_id, rule.add_label_id} - {None}:
            rules.setdefault(label_id, []).append(NamedRef(id=rule.id, name=rule.name))

    return [
        LabelUsage(
            label_id=label_id,
            ticket_count=counts.get(label_id, 0),
            views=views.get(label_id, []),
            hidden_view_count=hidden.get(label_id, 0),
            rules=rules.get(label_id, []),
        )
        for label_id in label_ids
    ]


def delete_label(
    session: Session,
    current_user: User,
    label_id: int,
    merge_into: Optional[int] = None,
) -> None:
    """Delete a label, merging it into another or taking it off its tickets.

    A team admin's, unlike renaming: it changes saved views and automation
    rules as well as tickets, and rules are an admin's to write.

    - Merged, everything that pointed at it points at `merge_into`: its
      tickets (one link each, for a ticket that carried both), the saved
      views that filter by it, and the rules that name it.
    - Removed, its tickets lose it and so do saved views, which widen rather
      than filter by nothing, as they do when a status is deleted. A rule
      that named it is switched off with the label taken out of it, the way
      rules that moved work into a deleted sprint are: cleared and left on,
      a condition would start matching every ticket, and an action would do
      less than the rule says.

    No history is written for the tickets. Nobody changed them: a label was
    tidied away from under them, as a column is when a status is deleted.
    """
    label = _label_or_404(session, label_id)
    require_team_admin(label.team_id, current_user, session)

    if merge_into is not None:
        target = session.get(Label, merge_into)
        if target is None or target.team_id != label.team_id:
            raise api_error(
                status_code=400,
                code=ErrorCode.not_on_this_team,
                detail="No such label on this team",
            )
        if target.id == label.id:
            raise api_error(
                status_code=400,
                code=ErrorCode.label_merge_into_same,
                detail="Merge it into a different label",
            )
        _merge(session, label, target)
    else:
        _remove(session, label)

    session.delete(label)
    session.commit()


def _merge(session: Session, label: Label, target: Label) -> None:
    already = set(
        session.exec(
            select(TicketLabelLink.ticket_id).where(
                TicketLabelLink.label_id == target.id
            )
        ).all()
    )
    for link in session.exec(
        select(TicketLabelLink).where(TicketLabelLink.label_id == label.id)
    ).all():
        # The link's key is the pair, so it is replaced rather than edited.
        session.delete(link)
        if link.ticket_id not in already:
            session.add(TicketLabelLink(ticket_id=link.ticket_id, label_id=target.id))
    for view in session.exec(
        select(SavedView).where(SavedView.label_id == label.id)
    ).all():
        view.label_id = target.id
        session.add(view)
    for rule in _rules_naming(session, label):
        if rule.if_label_id == label.id:
            rule.if_label_id = target.id
        if rule.add_label_id == label.id:
            rule.add_label_id = target.id
        session.add(rule)
    session.flush()


def _remove(session: Session, label: Label) -> None:
    for link in session.exec(
        select(TicketLabelLink).where(TicketLabelLink.label_id == label.id)
    ).all():
        session.delete(link)
    for view in session.exec(
        select(SavedView).where(SavedView.label_id == label.id)
    ).all():
        view.label_id = None
        session.add(view)
    for rule in _rules_naming(session, label):
        if rule.if_label_id == label.id:
            rule.if_label_id = None
        if rule.add_label_id == label.id:
            rule.add_label_id = None
        rule.is_enabled = False
        session.add(rule)
    session.flush()


def _rules_naming(session: Session, label: Label) -> list[AutomationRule]:
    return session.exec(
        select(AutomationRule).where(
            or_(
                AutomationRule.if_label_id == label.id,
                AutomationRule.add_label_id == label.id,
            )
        )
    ).all()

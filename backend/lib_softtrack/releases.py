"""Releases: the versions a team ships (#272).

A release is a name for a set of tickets -- "1.4.0" -- and nothing more: no
deploy, no build pipeline. What it adds is the one question sprints and
epics leave open, which version a piece of work shipped in. A ticket points
at its release by `Ticket.fix_version_id`, one release per ticket.

Two decisions, both borrowed from sprints.

**State is set, not derived.** Every ticket in a release being done is
evidence it is ready, not a decision to ship it. Releasing is a gesture of
its own, and it is the only way to `released`.

**Releasing never loses work.** What is not done is asked about: moved to
another planned release, or left without one. It is not left pointing at a
version that has already gone out without it.
"""

from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import case, func, or_
from sqlmodel import Session, select

from lib_softtrack.history import record_changes, snapshot
from lib_softtrack.models.releases import (
    ReleaseCreate,
    ReleaseNotes,
    ReleaseProgress,
    ReleaseRead,
    ReleaseRequest,
    ReleaseResult,
    ReleaseUpdate,
)
from lib_softtrack.statuses import RESOLVED, in_category
from lib_softtrack.tables import (
    AutomationRule,
    Release,
    ReleaseState,
    SavedView,
    StatusCategory,
    Team,
    TestRun,
    Ticket,
    TicketType,
    User,
)
from lib_softtrack.teams import get_team_or_404, require_team_member
from lib_softtrack.trash import INCLUDE_TRASHED
from lib_utils.errors import ErrorCode, api_error

#: Planned first -- what is coming is what a team looks for -- then what has
#: shipped, then what was put away.
_STATE_ORDER = {
    ReleaseState.planned: 0,
    ReleaseState.released: 1,
    ReleaseState.archived: 2,
}

#: The sections of the release notes, in the order a reader wants them:
#: what is new, then what was fixed, then the rest.
NOTE_SECTIONS: tuple[tuple[TicketType, str], ...] = (
    (TicketType.story, "Stories"),
    (TicketType.bug, "Bugs fixed"),
    (TicketType.task, "Tasks"),
)


def get_release_or_404(session: Session, release_id: int) -> Release:
    release = session.get(Release, release_id)
    if release is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.release_not_found,
            detail="Release not found",
        )
    return release


def release_progress(
    session: Session, release_ids: list[int]
) -> dict[int, ReleaseProgress]:
    """Progress for several releases in one query, leaving out what was
    cancelled (see ReleaseProgress)."""
    found: dict[int, ReleaseProgress] = {}
    if release_ids:
        done = in_category(StatusCategory.done)
        rows = session.exec(
            select(
                Ticket.fix_version_id,
                func.count(),
                func.coalesce(func.sum(case((done, 1), else_=0)), 0),
                func.coalesce(func.sum(Ticket.estimate), 0),
                func.coalesce(func.sum(case((done, Ticket.estimate), else_=0)), 0),
                func.count(Ticket.estimate),
            )
            .where(
                Ticket.fix_version_id.in_(release_ids),
                ~in_category(StatusCategory.cancelled),
            )
            .group_by(Ticket.fix_version_id)
        ).all()
        for release_id, total, done_count, points, points_done, sized in rows:
            found[release_id] = ReleaseProgress(
                tickets_total=int(total),
                tickets_done=int(done_count),
                points_total=int(points),
                points_done=int(points_done),
                tickets_unestimated=int(total) - int(sized),
            )
    return {
        release_id: found.get(
            release_id,
            ReleaseProgress(
                tickets_total=0,
                tickets_done=0,
                points_total=0,
                points_done=0,
                tickets_unestimated=0,
            ),
        )
        for release_id in release_ids
    }


def _to_read(release: Release, progress: ReleaseProgress) -> ReleaseRead:
    return ReleaseRead(
        id=release.id,
        team_id=release.team_id,
        name=release.name,
        description=release.description,
        target_date=release.target_date,
        state=release.state,
        released_on=release.released_on,
        progress=progress,
        created_at=release.created_at,
    )


def _read(session: Session, release: Release) -> ReleaseRead:
    return _to_read(release, release_progress(session, [release.id])[release.id])


def _text(value: Optional[str]) -> Optional[str]:
    """Blank is nothing: a description of whitespace reads as unset."""
    return value.strip() or None if value is not None else None


def _name(session: Session, team_id: int, name: str, except_id: Optional[int] = None):
    """The name, or a 409 if the team has a release called that already."""
    taken = session.exec(
        select(Release).where(Release.team_id == team_id, Release.name == name)
    ).first()
    if taken is not None and taken.id != except_id:
        raise api_error(
            status_code=409,
            code=ErrorCode.release_name_taken,
            detail=f"There is already a release called {name} on this team.",
        )
    return name


def _sort_key(release: Release) -> tuple:
    """Planned, released, archived; newest first within each -- by the day it
    shipped, or failing that the day it is for -- and one with no date at all
    first, since it is the one still being decided."""
    day = release.released_on or release.target_date
    return (
        _STATE_ORDER[release.state],
        day is not None,
        -(day.toordinal() if day else 0),
        -release.id,
    )


def list_releases(
    session: Session, current_user: User, team_id: int
) -> list[ReleaseRead]:
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    releases = sorted(
        session.exec(select(Release).where(Release.team_id == team_id)).all(),
        key=_sort_key,
    )
    progress = release_progress(session, [release.id for release in releases])
    return [_to_read(release, progress[release.id]) for release in releases]


def create_release(
    session: Session, current_user: User, team_id: int, payload: ReleaseCreate
) -> ReleaseRead:
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    release = Release(
        team_id=team_id,
        name=_name(session, team_id, payload.name),
        description=_text(payload.description),
        target_date=payload.target_date,
    )
    session.add(release)
    session.commit()
    session.refresh(release)
    return _read(session, release)


def get_release(session: Session, current_user: User, release_id: int) -> ReleaseRead:
    release = get_release_or_404(session, release_id)
    require_team_member(release.team_id, current_user, session)
    return _read(session, release)


def update_release(
    session: Session, current_user: User, release_id: int, payload: ReleaseUpdate
) -> ReleaseRead:
    release = get_release_or_404(session, release_id)
    require_team_member(release.team_id, current_user, session)
    data = payload.model_dump(exclude_unset=True)

    if data.get("name") is not None:
        release.name = _name(session, release.team_id, data["name"], release.id)
    if "description" in data:
        release.description = _text(data["description"])
    if "target_date" in data:
        release.target_date = data["target_date"]

    state = data.get("state")
    if state is ReleaseState.released and release.released_on is None:
        raise api_error(
            status_code=409,
            code=ErrorCode.release_not_released,
            detail=f"{release.name} has not been released. Releasing it asks "
            "what to do with the tickets that are not done.",
        )
    if state is ReleaseState.planned:
        # Reopened: it has not shipped after all, so it has no day it did.
        release.released_on = None
    if state is not None:
        release.state = state

    if data.get("released_on") is not None:
        if release.released_on is None:
            raise api_error(
                status_code=409,
                code=ErrorCode.release_not_released,
                detail=f"{release.name} has not been released yet.",
            )
        release.released_on = data["released_on"]

    session.add(release)
    session.commit()
    session.refresh(release)
    return _read(session, release)


def _not_planned(release: Release) -> str:
    if release.state is ReleaseState.archived:
        return f"{release.name} is archived."
    return f"{release.name} has been released already."


def release_release(
    session: Session, current_user: User, release_id: int, payload: ReleaseRequest
) -> ReleaseResult:
    """Ship it: set the day, and move what is not done or leave it without a
    release (#272).

    "Not done" is what is still open. A cancelled ticket stays where it is:
    it is not waiting for anything, and moving it on would put it in the
    next release's notes' way as well.
    """
    release = get_release_or_404(session, release_id)
    require_team_member(release.team_id, current_user, session)
    if release.state is not ReleaseState.planned:
        raise api_error(
            status_code=409,
            code=ErrorCode.release_not_planned,
            detail=_not_planned(release),
        )

    target: Optional[Release] = None
    if payload.move_to_release_id is not None:
        target = session.get(Release, payload.move_to_release_id)
        if target is None or target.team_id != release.team_id:
            raise api_error(
                status_code=400,
                code=ErrorCode.not_on_this_team,
                detail="No such release on this team",
            )
        if target.id == release.id or target.state is not ReleaseState.planned:
            raise api_error(
                status_code=409,
                code=ErrorCode.release_not_planned,
                detail=(
                    f"The tickets not done go to a release still to come, and "
                    f"{target.name} is not one."
                ),
            )

    unfinished = session.exec(
        select(Ticket)
        .where(Ticket.fix_version_id == release.id, ~in_category(*RESOLVED))
        .order_by(Ticket.number)
    ).all()
    for ticket in unfinished:
        before = snapshot(ticket)
        ticket.fix_version_id = target.id if target else None
        session.add(ticket)
        # Through the history like any other change, so a ticket's Activity
        # says it was moved on from 1.4.0 and by whom.
        record_changes(session, ticket, before, current_user)

    release.state = ReleaseState.released
    release.released_on = payload.released_on or datetime.now(timezone.utc).date()
    session.add(release)
    session.commit()
    session.refresh(release)
    return ReleaseResult(
        release=_read(session, release),
        moved=len(unfinished),
        moved_to_release_id=target.id if target else None,
    )


def _long_date(day: date) -> str:
    return f"{day.day} {day:%B %Y}"


def release_notes(
    session: Session, current_user: User, release_id: int
) -> ReleaseNotes:
    """A draft of the notes, from the done tickets, grouped by type (#272).

    A sub-ticket whose parent is in the notes too is left to its parent: the
    notes say what shipped, and the parent is the part a reader knows.
    """
    release = get_release_or_404(session, release_id)
    require_team_member(release.team_id, current_user, session)
    team = session.get(Team, release.team_id)

    done = session.exec(
        select(Ticket)
        .where(
            Ticket.fix_version_id == release.id,
            in_category(StatusCategory.done),
        )
        .order_by(Ticket.number)
    ).all()
    in_notes = {ticket.id for ticket in done}

    lines = [f"# {release.name}", ""]
    if release.released_on is not None:
        lines += [f"Released {_long_date(release.released_on)}.", ""]
    if release.description:
        lines += [release.description, ""]
    for ticket_type, heading in NOTE_SECTIONS:
        tickets = [
            ticket
            for ticket in done
            if ticket.type is ticket_type and ticket.parent_id not in in_notes
        ]
        if not tickets:
            continue
        lines += [f"## {heading}", ""]
        lines += [
            f"- {ticket.title} ({team.key}-{ticket.number})" for ticket in tickets
        ]
        lines.append("")
    return ReleaseNotes(markdown="\n".join(lines).rstrip() + "\n")


def delete_release(session: Session, current_user: User, release_id: int) -> None:
    """Delete a release. Its tickets are left without one, through their
    history; the views that filtered on it forget it; and a rule that set it
    is switched off, as one that moved work into a deleted sprint is."""
    release = get_release_or_404(session, release_id)
    require_team_member(release.team_id, current_user, session)

    # The trash too: a ticket restored later must not point at nothing. A bug
    # found in it (#273) forgets that as well.
    for ticket in session.exec(
        select(Ticket)
        .where(
            or_(Ticket.fix_version_id == release_id, Ticket.found_in_id == release_id)
        )
        .execution_options(**INCLUDE_TRASHED)
    ).all():
        before = snapshot(ticket)
        if ticket.fix_version_id == release_id:
            ticket.fix_version_id = None
        if ticket.found_in_id == release_id:
            ticket.found_in_id = None
        session.add(ticket)
        record_changes(session, ticket, before, current_user)

    for view in session.exec(
        select(SavedView).where(SavedView.team_id == release.team_id)
    ).all():
        if release_id in (view.fix_version_ids or []) or release_id in (
            view.found_in_ids or []
        ):
            view.fix_version_ids = [
                other for other in view.fix_version_ids if other != release_id
            ]
            view.found_in_ids = [
                other for other in view.found_in_ids if other != release_id
            ]
            session.add(view)

    # The runs for it (#275) stay, for nothing in particular.
    from lib_softtrack import runs as runs_service

    runs_service.forget(session, TestRun.release_id, release_id)

    for rule in session.exec(
        select(AutomationRule).where(AutomationRule.set_fix_version_id == release_id)
    ).all():
        rule.set_fix_version_id = None
        rule.is_enabled = False
        session.add(rule)
    session.flush()

    session.delete(release)
    session.commit()

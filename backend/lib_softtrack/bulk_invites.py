"""Inviting many people at once (#304).

A department of fifteen onto two teams used to be thirty trips through the
invitation form. Here it is one: the addresses pasted, a role, the teams, a
preview of what will happen to each address, and a summary afterwards.

Nothing here is a new kind of invitation. Every one is made by
`invites.create_invite`, by the rules it already follows: one per address per
team, re-inviting an address is the resend (a fresh link, the old one dead),
and a link stays tied to the address it was made for. There are deliberately
no links anybody can use.

Where a site admin may create accounts (#303), the same list can create them
instead -- `accounts.create_account`, again unchanged -- and put people with an
account already straight onto the teams.

Mail is sent here rather than after the response, unlike a single
invitation: the summary has to say which ones the mail server refused. The
invitation is made either way, so a refused one still has its link to copy.
"""

import logging
import re
from typing import Callable, Optional

from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlmodel import Session, select

from lib_identity.identity import find_user_by_email
from lib_softtrack.models.invites import (
    BulkInviteCreate,
    BulkInviteEntry,
    BulkInviteKind,
    BulkInviteResult,
    BulkInviteStatus,
    BulkInviteTeamResult,
    InviteCreate,
)
from lib_softtrack.tables import (
    PasswordReset,
    Team,
    TeamInvite,
    TeamMember,
    User,
    utcnow,
)
from lib_softtrack.teams import get_team_or_404, require_team_admin
from lib_utils.errors import ApiError, ErrorCode, api_error
from web import settings

logger = logging.getLogger("uvicorn.error")

Message = tuple[str, str, str]
Send = Callable[[str, str, str], None]

#: Reported for an invitation, or a new account's link, that was made but
#: that the mail server would not take.
MAIL_REFUSED = "mail_refused"

# One address: '"Name, quoted" <address>', 'Name <address>', or a bare run of
# anything that is not a separator. An unquoted name may not contain "@", so
# "a@x b@y <c@z>" is three addresses rather than a name "a@x b@y".
_TOKEN = re.compile(
    r'"([^"\n]*)"\s*<([^<>]*)>' r"|([^\",;<>@\n]*?)\s*<([^<>]*)>" r"|([^\s,;<>]+)"
)
_EMAIL = TypeAdapter(EmailStr)


def parse(text: str) -> list[tuple[int, str, Optional[str], Optional[str]]]:
    """Every address pasted, in order: (line, as pasted, email or None, name).

    Commas, semicolons, spaces and new lines all separate. An entry that is
    not an address comes back with no email, so the preview can point at it.
    """
    found = []
    for number, line in enumerate(text.splitlines(), start=1):
        for match in _TOKEN.finditer(line):
            quoted, q_address, plain, p_address, bare = match.groups()
            if bare is not None:
                raw, name, address = bare, None, bare
            else:
                raw = match.group(0).strip()
                name = (quoted if quoted is not None else plain).strip() or None
                address = (q_address if quoted is not None else p_address).strip()
            try:
                email = str(_EMAIL.validate_python(address)).strip().lower()
            except ValidationError:
                email = None
            found.append((number, raw, email, name))
    return found


def _name_from(email: str) -> str:
    """A name for an account made from a bare address: hana.suzuki@ ->
    Hana Suzuki. Its owner can change it."""
    local = email.split("@", 1)[0]
    words = [w for w in re.split(r"[._\-+]+", local) if w]
    return " ".join(w.capitalize() for w in words) or local


def _teams(
    session: Session, actor: User, team_id: int, payload: BulkInviteCreate
) -> list[Team]:
    """The teams asked for, each one the actor administers."""
    require_team_admin(team_id, actor, session)
    teams: list[Team] = []
    for tid in dict.fromkeys(payload.team_ids or [team_id]):
        team = get_team_or_404(tid, session)
        require_team_admin(tid, actor, session)
        teams.append(team)
    return teams


def _plan(
    session: Session, user: Optional[User], email: str, team: Team, accounts: bool
) -> tuple[BulkInviteKind, Optional[str], Optional[str]]:
    """What would happen to `email` on `team`: (kind, reason, detail)."""
    if user is not None and user.is_external:
        # Somebody from outside is invited one at a time, with the epics they
        # may see (#243): a bulk invitation is for the organisation.
        return (
            BulkInviteKind.refused,
            ErrorCode.account_outside_organisation.value,
            f"{user.full_name} is from outside the organisation",
        )
    if user is not None:
        member = session.exec(
            select(TeamMember).where(
                TeamMember.team_id == team.id, TeamMember.user_id == user.id
            )
        ).first()
        if member:
            return BulkInviteKind.member, ErrorCode.already_member.value, None
    if accounts:
        if user is not None and not user.is_active:
            return (
                BulkInviteKind.refused,
                ErrorCode.account_deactivated.value,
                "That account has been deactivated",
            )
        return (BulkInviteKind.add if user else BulkInviteKind.account), None, None
    live = session.exec(
        select(TeamInvite).where(
            TeamInvite.team_id == team.id,
            TeamInvite.email == email,
            TeamInvite.expires_at > utcnow(),
        )
    ).first()
    return (
        (BulkInviteKind.fresh_link if live else BulkInviteKind.invite),
        None,
        None,
    )


def _failed(result: BulkInviteTeamResult, error: ApiError) -> None:
    result.status = BulkInviteStatus.failed
    result.reason = error.code.value
    result.detail = error.detail


def bulk_invite(
    session: Session,
    actor: User,
    team_id: int,
    payload: BulkInviteCreate,
    send: Send,
) -> BulkInviteResult:
    from lib_identity.accounts import create_account
    from lib_identity.models.admin import AdminUserCreate, AdminUserTeam
    from lib_softtrack.invites import create_invite
    from lib_softtrack.models.teams import TeamMemberAdd
    from lib_softtrack.teams import add_team_member

    get_team_or_404(team_id, session)
    teams = _teams(session, actor, team_id, payload)
    if payload.create_accounts and not actor.is_site_admin:
        raise api_error(
            status_code=403,
            code=ErrorCode.not_site_admin,
            detail="Only site administrators can create accounts",
        )
    if payload.send_email and not settings.email_delivery_configured:
        raise api_error(
            status_code=400,
            code=ErrorCode.email_not_configured,
            detail="This instance cannot send email. Copy the links instead.",
        )

    parsed = parse(payload.addresses)
    if not parsed:
        raise api_error(
            status_code=400,
            code=ErrorCode.no_addresses,
            detail="Paste at least one address",
        )
    limit = settings.bulk_invite_limit
    if len(parsed) > limit:
        raise api_error(
            status_code=400,
            code=ErrorCode.too_many_addresses,
            detail=f"One submission takes up to {limit} addresses; "
            f"this one has {len(parsed)}",
        )

    entries: list[BulkInviteEntry] = []
    seen: set[str] = set()
    for line, raw, email, name in parsed:
        if email is None:
            entries.append(BulkInviteEntry(line=line, text=raw, is_address=False))
            continue
        # The same address twice is one person: the first mention stands.
        if email in seen:
            continue
        seen.add(email)
        user = find_user_by_email(session, email)
        entry = BulkInviteEntry(
            line=line,
            text=raw,
            email=email,
            name=user.full_name if user else name,
        )
        for team in teams:
            kind, reason, detail = _plan(
                session, user, email, team, payload.create_accounts
            )
            entry.teams.append(
                BulkInviteTeamResult(
                    team_id=team.id,
                    team_name=team.name,
                    kind=kind,
                    reason=reason,
                    detail=detail,
                )
            )
        entries.append(entry)

    if payload.preview:
        return BulkInviteResult(preview=True, entries=entries)

    # Each message, and what to mark failed if the mail server refuses it.
    outbox: list[tuple[Message, list[BulkInviteTeamResult], Callable[[], None]]] = []

    for entry in entries:
        if not entry.is_address:
            continue
        new_account = [r for r in entry.teams if r.kind == BulkInviteKind.account]
        if new_account:
            try:
                created, message = create_account(
                    session,
                    actor,
                    AdminUserCreate(
                        full_name=entry.name or _name_from(entry.email),
                        email=entry.email,
                        teams=[
                            AdminUserTeam(team_id=r.team_id, role=payload.role)
                            for r in new_account
                        ],
                        send_email=payload.send_email,
                    ),
                )
            except ApiError as error:
                for result in new_account:
                    _failed(result, error)
            else:
                entry.welcome_link = created.link
                entry.name = created.user.full_name
                for result in new_account:
                    result.status = BulkInviteStatus.sent
                _settle_invites(session, entry.email, [r.team_id for r in new_account])
                if message is not None:
                    user_id = created.user.id
                    outbox.append(
                        (
                            message,
                            new_account,
                            lambda u=user_id: _unmail_link(session, u),
                        )
                    )

        for result in entry.teams:
            if result.kind in (BulkInviteKind.member, BulkInviteKind.refused):
                result.status = (
                    BulkInviteStatus.skipped
                    if result.kind == BulkInviteKind.member
                    else BulkInviteStatus.failed
                )
            elif result.kind == BulkInviteKind.add:
                try:
                    add_team_member(
                        session,
                        actor,
                        result.team_id,
                        TeamMemberAdd(email=entry.email, role=payload.role),
                    )
                except ApiError as error:
                    _failed(result, error)
                else:
                    result.status = BulkInviteStatus.sent
                    _settle_invites(session, entry.email, [result.team_id])
            elif result.kind in (BulkInviteKind.invite, BulkInviteKind.fresh_link):
                try:
                    invite, message = create_invite(
                        session,
                        actor,
                        result.team_id,
                        InviteCreate(
                            email=entry.email,
                            role=payload.role,
                            send_email=payload.send_email,
                        ),
                    )
                except ApiError as error:
                    _failed(result, error)
                else:
                    result.status = BulkInviteStatus.sent
                    result.invite = invite
                    if message is not None:
                        outbox.append(
                            (
                                message,
                                [result],
                                lambda r=result: _unmail_invite(session, r),
                            )
                        )

    for message, results, unmark in outbox:
        try:
            send(*message)
        except Exception:  # noqa: BLE001 -- any failure is the same to the admin
            logger.warning("bulk invite: could not email %s", message[0], exc_info=True)
            unmark()
            for result in results:
                result.status = BulkInviteStatus.failed
                result.reason = MAIL_REFUSED
                result.detail = "The mail server refused it"

    totals = {status: 0 for status in BulkInviteStatus}
    for entry in entries:
        if not entry.is_address:
            totals[BulkInviteStatus.skipped] += 1
        for result in entry.teams:
            totals[result.status] += 1
    return BulkInviteResult(
        preview=False,
        entries=entries,
        sent=totals[BulkInviteStatus.sent],
        skipped=totals[BulkInviteStatus.skipped],
        failed=totals[BulkInviteStatus.failed],
    )


def _settle_invites(session: Session, email: str, team_ids: list[int]) -> None:
    """Somebody put on a team directly has no use for an invitation to it."""
    for invite in session.exec(
        select(TeamInvite).where(
            TeamInvite.email == email, TeamInvite.team_id.in_(team_ids)
        )
    ).all():
        session.delete(invite)
    session.commit()


def _unmail_invite(session: Session, result: BulkInviteTeamResult) -> None:
    """The invitation was not emailed after all: say so, here and in the
    pending list."""
    invite = session.get(TeamInvite, result.invite.id)
    if invite is not None:
        invite.emailed_at = None
        session.add(invite)
        session.commit()
    result.invite.emailed_at = None


def _unmail_link(session: Session, user_id: int) -> None:
    for row in session.exec(
        select(PasswordReset).where(PasswordReset.user_id == user_id)
    ).all():
        row.emailed_at = None
        session.add(row)
    session.commit()

"""Invitations: asking someone to join a team, whether or not they have an account.

An invitation is a link. The inviter copies it and sends it by whatever the
team already uses, and where SMTP is configured SoftTrack can also email it
(#84) -- as an addition, never instead: copying the link works everywhere.
That shapes the design more than anything else here: the link is the
credential, so its token is unguessable, it expires, and accepting it checks
the signed-in user's address against the one it was sent to -- a forwarded
link admits nobody it was not meant for.
"""

import secrets
from datetime import timedelta
from typing import Optional

from sqlmodel import Session, delete, select

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.invites import InviteCreate, InvitePreview, InviteRead
from lib_softtrack.tables import Team, TeamInvite, TeamMember, TeamRole, User, utcnow
from lib_softtrack.teams import get_team_or_404, require_team_admin
from web import settings
from lib_utils.errors import ErrorCode, api_error


def _new_token() -> str:
    return secrets.token_urlsafe(32)


def _expiry():
    return utcnow() + timedelta(days=settings.invite_expire_days)


def _prune_expired(session: Session) -> None:
    """Delete invitations that have run out.

    Done on read rather than by a scheduled job: SoftTrack is one process with
    no scheduler, expired rows are only ever in the way of the two queries that
    look at them, and an instance nobody opens has nothing to clean up.
    """
    session.exec(delete(TeamInvite).where(TeamInvite.expires_at <= utcnow()))
    session.commit()


def find_live_invite(session: Session, email: str) -> TeamInvite | None:
    """Any unexpired invitation addressed to `email`. Used by registration."""
    return session.exec(
        select(TeamInvite).where(
            TeamInvite.email == email.strip().lower(),
            TeamInvite.expires_at > utcnow(),
        )
    ).first()


def _to_read(session: Session, invite: TeamInvite, team: Team) -> InviteRead:
    inviter = session.get(User, invite.invited_by_id)
    return InviteRead(
        id=invite.id,
        team_id=invite.team_id,
        team_name=team.name,
        team_key=team.key,
        email=invite.email,
        role=invite.role,
        token=invite.token,
        invited_by=UserPublic.model_validate(inviter),
        created_at=invite.created_at,
        expires_at=invite.expires_at,
        emailed_at=invite.emailed_at,
    )


def _invite_email(
    invite: TeamInvite, team: Team, inviter: User
) -> tuple[str, str, str]:
    """The message: who, which team, the link, and when it stops working.

    Plain text, like the digest, and written to be understood by somebody
    who has never heard of SoftTrack -- which, for most invitees, is true.
    """
    link = f"{settings.app_base_url.rstrip('/')}/invite/{invite.token}"
    role = "an admin" if invite.role == TeamRole.admin else "a member"
    expires = f"{invite.expires_at.day} {invite.expires_at:%B %Y}"
    body = (
        f"{inviter.full_name} ({inviter.email}) has invited you to join the "
        f"{team.name} team on {settings.app_name}, as {role}.\n\n"
        f"To accept, open this link:\n\n{link}\n\n"
        f"You can sign in or create an account with {invite.email} from there. "
        f"The link works until {expires}.\n\n"
        "If you were not expecting this, you can ignore this email.\n"
    )
    subject = f"{inviter.full_name} invited you to {team.name} on {settings.app_name}"
    return invite.email, subject, body


def create_invite(
    session: Session, current_user: User, team_id: int, payload: InviteCreate
) -> tuple[InviteRead, Optional[tuple[str, str, str]]]:
    """Create an invitation -- or refresh one, which is the resend.

    Returns the invitation and, when `send_email` was asked for, the message
    to send. The caller sends it after responding: nothing about the
    invitation depends on an SMTP server answering quickly.
    """
    team = get_team_or_404(team_id, session)
    require_team_admin(team_id, current_user, session)
    if payload.send_email and not settings.email_delivery_configured:
        raise api_error(
            status_code=400,
            code=ErrorCode.email_not_configured,
            detail="This instance cannot send email. Copy the link instead.",
        )

    email = payload.email.strip().lower()

    from lib_identity.identity import find_user_by_email

    existing_user = find_user_by_email(session, email)
    if existing_user:
        already = session.exec(
            select(TeamMember).where(
                TeamMember.team_id == team_id,
                TeamMember.user_id == existing_user.id,
            )
        ).first()
        if already:
            raise api_error(
                status_code=400,
                code=ErrorCode.already_member,
                detail="User is already a member",
            )

    invite = session.exec(
        select(TeamInvite).where(
            TeamInvite.team_id == team_id, TeamInvite.email == email
        )
    ).first()

    if invite:
        # Re-inviting the same address *is* the resend: a fresh token and a
        # fresh clock, so the new link works and any older copy stops.
        invite.token = _new_token()
        invite.expires_at = _expiry()
        invite.role = payload.role
        invite.invited_by_id = current_user.id
        invite.created_at = utcnow()
    else:
        invite = TeamInvite(
            team_id=team_id,
            email=email,
            role=payload.role,
            token=_new_token(),
            invited_by_id=current_user.id,
            expires_at=_expiry(),
        )
    # Set on every create and resend, so an email sent with an older link is
    # never reported as if it carried this one.
    invite.emailed_at = utcnow() if payload.send_email else None
    session.add(invite)
    session.commit()
    session.refresh(invite)

    message = _invite_email(invite, team, current_user) if payload.send_email else None
    return _to_read(session, invite, team), message


def list_invites(
    session: Session, current_user: User, team_id: int
) -> list[InviteRead]:
    team = get_team_or_404(team_id, session)
    require_team_admin(team_id, current_user, session)
    _prune_expired(session)

    invites = session.exec(
        select(TeamInvite)
        .where(TeamInvite.team_id == team_id)
        .order_by(TeamInvite.created_at)
    ).all()
    return [_to_read(session, invite, team) for invite in invites]


def revoke_invite(
    session: Session, current_user: User, team_id: int, invite_id: int
) -> None:
    get_team_or_404(team_id, session)
    require_team_admin(team_id, current_user, session)

    invite = session.get(TeamInvite, invite_id)
    # The team is part of the lookup, not just the id: an admin of one team
    # must not be able to revoke another team's invitation by guessing a number.
    if not invite or invite.team_id != team_id:
        raise api_error(
            status_code=404,
            code=ErrorCode.invite_not_found,
            detail="Invitation not found",
        )

    session.delete(invite)
    session.commit()


def _live_invite_or_404(session: Session, token: str) -> TeamInvite:
    # The expiry is part of the query rather than a check on the row: the
    # comparison then happens in SQL, where both sides are UTC. SQLite hands
    # rows back with naive datetimes, and comparing one of those to an aware
    # `utcnow()` in Python raises.
    invite = session.exec(
        select(TeamInvite).where(
            TeamInvite.token == token, TeamInvite.expires_at > utcnow()
        )
    ).first()
    # Unknown and expired answer identically. Distinguishing them would turn
    # this public endpoint into a way to test whether a token was ever real.
    if not invite:
        raise api_error(
            status_code=404,
            code=ErrorCode.invite_invalid,
            detail="This invitation is no longer valid",
        )
    return invite


def get_invite_preview(session: Session, token: str) -> InvitePreview:
    invite = _live_invite_or_404(session, token)
    team = session.get(Team, invite.team_id)
    inviter = session.get(User, invite.invited_by_id)
    return InvitePreview(
        team_name=team.name,
        team_key=team.key,
        email=invite.email,
        role=invite.role,
        invited_by_name=inviter.full_name if inviter else "A teammate",
        expires_at=invite.expires_at,
    )


def _assert_addressed_to(invite: TeamInvite, user: User) -> None:
    if invite.email != user.email.strip().lower():
        raise api_error(
            status_code=403,
            code=ErrorCode.invite_wrong_recipient,
            detail="This invitation was sent to a different email address",
        )


def accept_invite(session: Session, current_user: User, token: str) -> Team:
    invite = _live_invite_or_404(session, token)
    _assert_addressed_to(invite, current_user)

    team = session.get(Team, invite.team_id)
    existing = session.exec(
        select(TeamMember).where(
            TeamMember.team_id == invite.team_id,
            TeamMember.user_id == current_user.id,
        )
    ).first()
    if not existing:
        session.add(
            TeamMember(
                team_id=invite.team_id, user_id=current_user.id, role=invite.role
            )
        )

    # Either way the invitation is spent. The membership row and its joined_at
    # are the record of what happened; a consumed invite is only clutter.
    session.delete(invite)
    session.commit()
    return team


def decline_invite(session: Session, current_user: User, token: str) -> None:
    invite = _live_invite_or_404(session, token)
    _assert_addressed_to(invite, current_user)
    session.delete(invite)
    session.commit()


def list_invites_for_user(session: Session, user: User) -> list[InviteRead]:
    """Every live invitation addressed to this person, across all teams."""
    _prune_expired(session)
    invites = session.exec(
        select(TeamInvite)
        .where(TeamInvite.email == user.email.strip().lower())
        .order_by(TeamInvite.created_at)
    ).all()
    return [
        _to_read(session, invite, session.get(Team, invite.team_id))
        for invite in invites
    ]

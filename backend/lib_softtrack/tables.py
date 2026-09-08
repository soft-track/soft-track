"""SQLModel table definitions and the enums that describe their columns.

The Educare backend has no direct counterpart to this module because it talks to
the database in raw SQL. Here the tables *are* the schema, so they live in one
place under `lib_softtrack` and are imported by both the identity and product
service layers.
"""

import enum
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import SQLModel, Field


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class IssueStatus(str, enum.Enum):
    backlog = "backlog"
    todo = "todo"
    in_progress = "in_progress"
    in_review = "in_review"
    done = "done"
    cancelled = "cancelled"


class IssuePriority(str, enum.Enum):
    no_priority = "no_priority"
    urgent = "urgent"
    high = "high"
    medium = "medium"
    low = "low"


class IssueLinkType(str, enum.Enum):
    """How one issue relates to another.

    Only three are stored. "Blocked by" and "duplicated by" are not types --
    they are the same rows read from the other end, which is what keeps the
    two issues from ever disagreeing about their relationship.

    `relates_to` is symmetric, so it is stored once and shown identically on
    both issues.
    """

    blocks = "blocks"
    relates_to = "relates_to"
    duplicates = "duplicates"


#: The types where direction carries meaning, and so where the same pair
#: cannot be linked both ways round.
DIRECTED_LINK_TYPES = (IssueLinkType.blocks, IssueLinkType.duplicates)


class CycleState(str, enum.Enum):
    """Where a cycle is in its life.

    Derived from dates would be simpler, but a team that forgets to start a
    cycle on Monday should not have Monday counted against its burndown, and a
    cycle that runs a day long should not silently complete itself and carry
    work away. So the state is set deliberately and the dates are the plan.
    """

    upcoming = "upcoming"
    active = "active"
    completed = "completed"


class IssueEventField(str, enum.Enum):
    """Which field an IssueEvent records a change to."""

    status = "status"
    cycle = "cycle"
    estimate = "estimate"


class TeamRole(str, enum.Enum):
    admin = "admin"
    member = "member"


class NotificationKind(str, enum.Enum):
    """Why a notification was raised.

    Deliberately about *what happened*, not about how the recipient came to
    care -- "someone commented" reads the same whether you are watching the
    issue because you filed it or because you were assigned it. Which of
    those is true is not information the inbox has any use for.
    """

    assigned = "assigned"
    mentioned = "mentioned"
    commented = "commented"
    status_changed = "status_changed"


# ---------------------------------------------------------------------------
# Link tables
# ---------------------------------------------------------------------------


class TeamMember(SQLModel, table=True):
    team_id: int = Field(foreign_key="team.id", primary_key=True)
    user_id: int = Field(foreign_key="user.id", primary_key=True)
    role: TeamRole = Field(default=TeamRole.member)
    joined_at: datetime = Field(default_factory=utcnow)


class IssueLabelLink(SQLModel, table=True):
    issue_id: int = Field(foreign_key="issue.id", primary_key=True)
    label_id: int = Field(foreign_key="label.id", primary_key=True)


# ---------------------------------------------------------------------------
# Core tables
# ---------------------------------------------------------------------------


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    #: The stable handle an `@mention` resolves to. Separate from the email
    #: because a mention written today should keep pointing at the same person
    #: after they change address, which an email-derived handle cannot promise.
    username: str = Field(index=True, unique=True)
    hashed_password: str
    full_name: str
    avatar_color: str = Field(default="#6366f1")
    #: Deactivated rather than deleted. Issues, comments and history all carry
    #: foreign keys to users, so removing the row would either cascade away
    #: someone's work or leave the tracker unable to say who did it.
    is_active: bool = Field(default=True)
    #: Instance-wide administrator: the user directory, deactivation, password
    #: resets. The first account registered gets it. Distinct from TeamRole,
    #: which only ever means something inside one team.
    is_site_admin: bool = Field(default=False)
    #: The per-user off switch for the email digest. Only consulted when the
    #: instance has SMTP configured at all -- with no mail server there is
    #: nothing to switch off, and the setting is hidden rather than lying.
    email_notifications: bool = Field(default=True)
    #: Copied into every JWT as `ver` and compared on each request. Bumping it
    #: invalidates every token already issued for this user, which is what
    #: makes "sign out everywhere", a password change and a deactivation take
    #: effect immediately rather than whenever the last token happens to expire.
    #: A blocklist would need storage and pruning to do the same job.
    token_version: int = Field(default=0)
    last_login_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)


class TeamInvite(SQLModel, table=True):
    """A pending invitation to join a team, addressed to an email.

    Deliberately a row that disappears rather than one carrying a status: an
    invite is accepted, declined or revoked, and in every case the interesting
    record afterwards is the TeamMember row (or its absence). Keeping dead
    invites around would mean every query filtering them out, and "resend"
    having to decide which of several rows it meant.

    One live invite per address per team, enforced in the database so two
    admins inviting the same person concurrently cannot both insert.
    """

    __table_args__ = (
        UniqueConstraint("team_id", "email", name="uq_team_invite_team_email"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: int = Field(foreign_key="team.id", index=True)
    #: Stored lowercased; accepting requires the signed-in user's address to
    #: match, so a forwarded link admits nobody it was not sent to.
    email: str = Field(index=True)
    role: TeamRole = Field(default=TeamRole.member)
    #: The bearer secret in the invite link. Unguessable rather than sequential
    #: because the link is the whole authentication for a stranger's first
    #: contact with the instance.
    token: str = Field(index=True, unique=True)
    invited_by_id: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=utcnow)
    expires_at: datetime


class Team(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    key: str = Field(index=True, unique=True, description="Short prefix, e.g. ENG")
    description: Optional[str] = None
    next_issue_number: int = Field(default=1)
    next_cycle_number: int = Field(default=1)
    created_at: datetime = Field(default_factory=utcnow)


class Project(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: int = Field(foreign_key="team.id", index=True)
    name: str
    description: Optional[str] = None
    color: str = Field(default="#6366f1")
    created_at: datetime = Field(default_factory=utcnow)


class Label(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: int = Field(foreign_key="team.id", index=True)
    name: str
    color: str = Field(default="#94a3b8")


class Issue(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: int = Field(foreign_key="team.id", index=True)
    project_id: Optional[int] = Field(
        default=None, foreign_key="project.id", index=True
    )
    number: int
    title: str
    description: Optional[str] = None
    status: IssueStatus = Field(default=IssueStatus.backlog, index=True)
    priority: IssuePriority = Field(default=IssuePriority.no_priority)
    assignee_id: Optional[int] = Field(default=None, foreign_key="user.id")
    # One level of nesting only -- an issue with a parent may not itself be a
    # parent. See lib_softtrack/subissues.py for why that limit is enforced
    # rather than left to convention.
    parent_id: Optional[int] = Field(default=None, foreign_key="issue.id", index=True)
    cycle_id: Optional[int] = Field(default=None, foreign_key="cycle.id", index=True)
    #: The identifier this issue had in the system it was imported from, e.g.
    #: a Jira key like "PROJ-142". Kept so links in old documents, commit
    #: messages and chat history stay traceable after a migration -- which is
    #: most of what makes a migration survivable.
    external_key: Optional[str] = Field(default=None, index=True)
    creator_id: int = Field(foreign_key="user.id")
    # Story points. Null means "not sized yet", which is a different thing
    # from zero -- a burndown has to be able to tell them apart.
    estimate: Optional[int] = Field(default=None)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class IssueLink(SQLModel, table=True):
    """A relationship between two issues, stored once and read from both ends.

    The unique constraint is what enforces "no duplicate links" -- doing it in
    the database rather than only in the service means two simultaneous
    requests cannot both pass a check-then-insert and create a pair of
    identical rows.
    """

    __table_args__ = (
        UniqueConstraint("source_id", "target_id", "type", name="uq_issue_link"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    source_id: int = Field(foreign_key="issue.id", index=True)
    target_id: int = Field(foreign_key="issue.id", index=True)
    type: IssueLinkType
    created_by_id: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=utcnow)


class Cycle(SQLModel, table=True):
    """A time-boxed iteration belonging to one team."""

    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: int = Field(foreign_key="team.id", index=True)
    #: Per team, and stable: "Cycle 7" keeps meaning the same fortnight after
    #: another cycle is deleted, which a positional index would not.
    number: int
    name: Optional[str] = None
    starts_at: datetime
    ends_at: datetime
    state: CycleState = Field(default=CycleState.upcoming, index=True)
    completed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)


class IssueEvent(SQLModel, table=True):
    """One recorded change to an issue field.

    This table is why reporting is possible at all. A burndown asks what the
    board looked like on the ninth of the month, and no amount of querying the
    current rows can answer that -- the history is simply gone unless it was
    written down as it happened. Every day this table does not exist is a day
    that can never be charted.

    Deliberately generic (field/old/new as text) rather than one table per
    field. The alternative is a new table and a new migration every time
    something else turns out to be worth charting, and the read patterns --
    "changes to this issue, in order" -- are identical whatever the field.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    issue_id: int = Field(foreign_key="issue.id", index=True)
    #: Denormalised from the issue so a report can filter a date range by team
    #: without joining, and so the row survives as history if the issue moves.
    team_id: int = Field(foreign_key="team.id", index=True)
    field: IssueEventField = Field(index=True)
    #: Null on the creation event for a field, and for a value being cleared.
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    actor_id: Optional[int] = Field(default=None, foreign_key="user.id")
    created_at: datetime = Field(default_factory=utcnow, index=True)


class Comment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    issue_id: int = Field(foreign_key="issue.id", index=True)
    author_id: int = Field(foreign_key="user.id")
    body: str
    created_at: datetime = Field(default_factory=utcnow)


class Attachment(SQLModel, table=True):
    """One uploaded file. The bytes live in storage; this is the metadata.

    Every attachment belongs to an issue, and *optionally* to one comment on
    that issue. Two reasons for the issue_id being mandatory rather than one
    nullable owner column: it is the only path to a team, so it is what every
    permission check reads; and it is what makes deleting an issue able to
    clean up in one query rather than walking its comments.

    A file is uploaded before the comment it belongs to exists -- you paste a
    screenshot, then write the sentence about it -- so it starts with
    comment_id null and the comment claims it on submit.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    issue_id: int = Field(foreign_key="issue.id", index=True)
    comment_id: Optional[int] = Field(
        default=None, foreign_key="comment.id", index=True
    )
    #: The name the uploader saw, stripped of any directory part. Shown and
    #: sent in Content-Disposition; never used to build a path.
    filename: str
    #: Derived from the extension, not copied from the request. See
    #: lib_softtrack/attachments.py -- a client does not get to choose the
    #: type its file is served back as.
    content_type: str
    size_bytes: int
    #: Opaque key into whichever storage backend is configured.
    storage_key: str
    uploaded_by_id: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=utcnow)


class IssueWatch(SQLModel, table=True):
    """Whether one person is following one issue.

    A row exists as soon as SoftTrack has an opinion about someone and an
    issue, and `watching` says which way. Storing "no" rather than deleting
    the row is the whole point: creating, commenting on or being assigned an
    issue auto-watches it, so a deleted row would be silently recreated by the
    next thing the person did and the unwatch would not survive the afternoon.
    A mute that does not stick is not a mute.
    """

    issue_id: int = Field(foreign_key="issue.id", primary_key=True)
    user_id: int = Field(foreign_key="user.id", primary_key=True)
    watching: bool = Field(default=True)
    created_at: datetime = Field(default_factory=utcnow)


class Notification(SQLModel, table=True):
    """One thing that happened, addressed to one person.

    A row per recipient rather than one event fanned out at read time. The
    read/unread state belongs to the person, not to the event, and so does
    "which of these have already been emailed" -- both of which a shared event
    row would have to carry in a side table keyed by exactly this pair.

    Nothing about the event is denormalised into it. The issue's title and the
    comment's body are read through the foreign keys when the inbox is built,
    so an issue renamed after the fact shows up under the name it has now,
    which is the one the reader will recognise.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    #: Who is being told. Indexed with `read_at` because every read of this
    #: table is "my unread ones" or "my recent ones".
    user_id: int = Field(foreign_key="user.id", index=True)
    kind: NotificationKind
    issue_id: int = Field(foreign_key="issue.id", index=True)
    #: Set when the event was a comment, so the inbox can quote it and link
    #: straight to it. Null for assignment and status changes.
    comment_id: Optional[int] = Field(
        default=None, foreign_key="comment.id", index=True
    )
    #: Who did it. Nullable because an importer or a future automation has no
    #: user behind it, and "Jira import assigned this to you" is still worth
    #: saying.
    actor_id: Optional[int] = Field(default=None, foreign_key="user.id")
    read_at: Optional[datetime] = Field(default=None, index=True)
    #: When this row went out in a digest. Set *before* the mail is sent and
    #: only on rows the update actually claimed, so two processes running the
    #: digest loop cannot both send the same notification.
    emailed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow, index=True)

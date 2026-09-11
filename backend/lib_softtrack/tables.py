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


class StatusCategory(str, enum.Enum):
    """What a status *means*, as opposed to what a team calls it.

    Fixed on purpose, and the reason per-team statuses are safe to allow at
    all. Everything that has to reason about work -- burndown, velocity, "is
    this cycle finished", "3 of 5 sub-issues done", whether a blocker still
    blocks -- asks the category, never the name. A team can add "Blocked" or
    "QA" without any of that having an opinion about it.

    Unconstrained workflow states are how Jira became Jira. These five are the
    line.
    """

    backlog = "backlog"
    #: Accepted, not started. "Todo".
    unstarted = "unstarted"
    #: Work in flight, whatever the team calls the stages of it.
    started = "started"
    done = "done"
    #: Closed without being delivered. Not outstanding, and not an achievement.
    cancelled = "cancelled"


#: The workflow every new team starts with, and what the fixed enum used to
#: be. Name, category, colour -- in board order.
DEFAULT_STATUSES: tuple[tuple[str, "StatusCategory", str], ...] = (
    ("Backlog", StatusCategory.backlog, "#9b98b0"),
    ("Todo", StatusCategory.unstarted, "#6f6c86"),
    ("In Progress", StatusCategory.started, "#f29d0b"),
    ("In Review", StatusCategory.started, "#8b5cf6"),
    ("Done", StatusCategory.done, "#12a474"),
    ("Cancelled", StatusCategory.cancelled, "#f2647d"),
)


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


class AutomationTrigger(str, enum.Enum):
    """What makes an automation rule look at an issue.

    Eight, and not extensible by a team. Every one of them is something
    SoftTrack already writes down as it happens, which is what keeps the
    engine to "read the event, read the rules, apply them" instead of a
    scheduler with a clock of its own. There is deliberately no "every
    Monday": a rule that fires while nobody is doing anything is a rule
    nobody remembers exists when it surprises them.

    The last three arrive from a connected repository rather than from
    somebody using the tracker. They are triggers rather than a settings pair
    of their own -- "which status means in review", "which means shipped" --
    because that pair is a second engine for "when X happens, change the
    issue", and this one already exists, already has conditions, and already
    writes down what it did.
    """

    issue_created = "issue_created"
    #: The issue moved to a different column. Conditions are read against the
    #: status it moved *to* -- see AutomationRule.if_status_id.
    status_changed = "status_changed"
    #: Somebody was put on it. Not fired by an issue being *un*assigned, which
    #: is a different event and leaves nobody to act on.
    issue_assigned = "issue_assigned"
    comment_added = "comment_added"
    #: Once per issue that was in the cycle, after the unfinished work has
    #: carried over -- see lib_softtrack/cycles.py.
    cycle_completed = "cycle_completed"

    #: A branch naming this issue appeared. Fires the first time the branch is
    #: seen, not on every push to it.
    branch_created = "branch_created"
    #: A pull or merge request naming this issue was opened.
    pull_request_opened = "pull_request_opened"
    #: ...and merged. Closed-without-merging is not this trigger: the work did
    #: not ship, and a rule moving the issue to Done would be wrong about the
    #: one thing it is for.
    pull_request_merged = "pull_request_merged"


class GitProvider(str, enum.Enum):
    github = "github"
    gitlab = "gitlab"


class CodeLinkKind(str, enum.Enum):
    """What kind of thing in a repository is linked to an issue."""

    branch = "branch"
    commit = "commit"
    #: A GitHub pull request or a GitLab merge request. One name here because
    #: they are the same object with two vendors' words for it, and an issue
    #: page that said "merge requests" to half its readers would be worse than
    #: one that picks a word.
    pull_request = "pull_request"


class PullRequestState(str, enum.Enum):
    """Where a pull request is. Only meaningful for `CodeLinkKind.pull_request`.

    `merged` and `closed` are separate states rather than one "not open",
    because the whole point of the distinction is that one of them shipped
    the work and the other did not.
    """

    open = "open"
    merged = "merged"
    closed = "closed"


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
    #: The view everyone on this team lands on, unless they have chosen their
    #: own -- see UserDefaultView. Only a shared view may hold it, since a
    #: private one would be invisible to everybody it was defaulted for.
    #:
    #: A column here rather than a flag on SavedView so that "at most one
    #: default" is a fact about the schema instead of an invariant the service
    #: has to keep re-establishing.
    default_view_id: Optional[int] = Field(default=None, foreign_key="savedview.id")
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
    #: The team's own status row, not a fixed enum. What the issue *means* --
    #: started, done -- is the status's category; see StatusCategory.
    status_id: int = Field(foreign_key="workflowstatus.id", index=True)
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
    #: Null when an automation rule wrote it. The alternative was to author
    #: those as whoever happened to trip the rule, which puts words in a
    #: person's mouth on the one kind of comment nobody wrote -- and the
    #: comment most likely to be argued with. `Notification.actor_id` is
    #: nullable for the same event and the same reason.
    author_id: Optional[int] = Field(default=None, foreign_key="user.id")
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


class SavedView(SQLModel, table=True):
    """A named set of filters over one team's issues.

    The filters are columns rather than a JSON blob. The set is small, fixed
    and already described by enums the API publishes, so columns get typed
    request and response models -- and therefore a typed frontend client --
    where a blob would reach the browser as `unknown`. Foreign keys also mean
    a view cannot outlive the label or cycle it filters on without somebody
    having to decide what happens, which is the conversation a blob quietly
    skips.

    Every field is nullable and null means "no opinion", so a view with
    nothing set is "all issues" rather than a contradiction that matches
    nothing.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: int = Field(foreign_key="team.id", index=True)
    name: str
    owner_id: int = Field(foreign_key="user.id", index=True)
    #: Visible to the whole team rather than only its owner. Any member may
    #: share one: a tracker where a useful filter needs an admin to publish it
    #: is a tracker where people paste URLs to each other instead.
    is_shared: bool = Field(default=False, index=True)

    #: Cleared when the status is deleted -- see lib_softtrack/statuses.py.
    status_id: Optional[int] = Field(default=None, foreign_key="workflowstatus.id")
    priority: Optional[IssuePriority] = None
    assignee_id: Optional[int] = Field(default=None, foreign_key="user.id")
    #: Distinct from `assignee_id is None`, which means "any assignee". The two
    #: are mutually exclusive and the request model rejects setting both.
    unassigned: bool = Field(default=False)
    label_id: Optional[int] = Field(default=None, foreign_key="label.id")
    project_id: Optional[int] = Field(default=None, foreign_key="project.id")
    #: Cleared when the cycle is deleted -- see lib_softtrack/cycles.py. A view
    #: pointing at a cycle that no longer exists would match nothing and look
    #: broken rather than empty.
    cycle_id: Optional[int] = Field(default=None, foreign_key="cycle.id")

    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class UserDefaultView(SQLModel, table=True):
    """One person's landing view for one team, overriding the team's default.

    A row exists only for someone who has chosen; everyone else falls through
    to `Team.default_view_id`. Storing the absence of a choice as no row is
    what keeps "the admin changed the team default" from silently skipping
    the people who never expressed a preference.
    """

    user_id: int = Field(foreign_key="user.id", primary_key=True)
    team_id: int = Field(foreign_key="team.id", primary_key=True)
    view_id: int = Field(foreign_key="savedview.id", index=True)


class WorkflowStatus(SQLModel, table=True):
    """One column on one team's board.

    Replaces the fixed `IssueStatus` enum. A team can add "Blocked" or "QA"
    and order its board how it likes; what none of them can do is invent a new
    *meaning*, because every status maps to one of the five fixed
    StatusCategory values and that is what the rest of the app reads.

    Named `WorkflowStatus` rather than `Status` because the table would
    otherwise collide with the Postgres enum type the old column left behind --
    a table and a type share one namespace there.
    """

    __table_args__ = (
        UniqueConstraint("team_id", "name", name="uq_workflow_status_team_name"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: int = Field(foreign_key="team.id", index=True)
    name: str
    category: StatusCategory = Field(index=True)
    #: Board order, low to high. Sparse and rewritten wholesale on reorder --
    #: gaps are harmless and contiguity is not worth a transaction to maintain.
    position: int
    color: str = Field(default="#9b98b0")
    created_at: datetime = Field(default_factory=utcnow)


class AutomationRule(SQLModel, table=True):
    """One trigger, some conditions, some actions -- scoped to a team.

    The shape is columns rather than a JSON blob, for the reasons SavedView
    gives: the vocabulary is small and fixed, the API publishes it as enums,
    and a typed frontend falls out of that where a blob would arrive in the
    browser as `unknown`. The foreign keys also mean a rule cannot quietly
    outlive the status or cycle it names -- deleting one of those has to
    decide what happens to the rule, which is the conversation a blob skips.

    **Conditions** are the `if_*` columns, ANDed, with null meaning "no
    opinion". A rule with none of them set fires on every event of its
    trigger, which is what an unconditioned rule should do. They are the same
    vocabulary a saved view filters on, deliberately: a team that can describe
    the issues it means in the filter bar can describe them here.

    **Actions** are the rest. At least one is required -- a rule that does
    nothing is a rule that will be read as broken -- and they are applied
    together, in one pass.

    Kept small on purpose. There is no OR, no "not", no priority ordering
    between rules and no branching. Every one of those is a step towards a
    workflow engine, which is the thing SoftTrack is trying not to become;
    two rules say "or" perfectly well.
    """

    __table_args__ = (
        UniqueConstraint("team_id", "name", name="uq_automation_rule_team_name"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: int = Field(foreign_key="team.id", index=True)
    name: str
    #: Off rather than deleted. A rule that did something surprising wants
    #: turning off in one click while somebody works out what it should have
    #: said, and its run log is easier to read next to the rule that wrote it.
    is_enabled: bool = Field(default=True, index=True)
    trigger: AutomationTrigger = Field(index=True)

    # --- Conditions: all optional, ANDed, null means "no opinion" ---------
    #: For `status_changed`, the status the issue moved *to*. For every other
    #: trigger, the status it is in when the rule looks at it -- which is the
    #: same column read the same way, so there is one rule to remember.
    if_status_id: Optional[int] = Field(default=None, foreign_key="workflowstatus.id")
    if_priority: Optional[IssuePriority] = None
    if_label_id: Optional[int] = Field(default=None, foreign_key="label.id")
    if_project_id: Optional[int] = Field(default=None, foreign_key="project.id")
    if_assignee_id: Optional[int] = Field(default=None, foreign_key="user.id")
    #: "Nobody is assigned", which `if_assignee_id = null` does not say -- that
    #: means "anybody". The two are mutually exclusive; the request model
    #: rejects setting both.
    if_unassigned: bool = Field(default=False)

    # --- Actions ---------------------------------------------------------
    set_status_id: Optional[int] = Field(default=None, foreign_key="workflowstatus.id")
    set_priority: Optional[IssuePriority] = None
    set_assignee_id: Optional[int] = Field(default=None, foreign_key="user.id")
    #: Added, never replacing what is there. Labels are additive everywhere
    #: else in SoftTrack, and a rule that silently stripped the ones somebody
    #: chose would be the worst reading of "add a label".
    add_label_id: Optional[int] = Field(default=None, foreign_key="label.id")
    set_cycle_id: Optional[int] = Field(default=None, foreign_key="cycle.id")
    #: "Whichever cycle is running when this fires", as opposed to a named
    #: one. Worth its own flag rather than leaving people to point at a cycle
    #: by id: the useful version of "put new urgent bugs in the sprint" has to
    #: keep meaning that a fortnight later, and a fixed id does not. Mutually
    #: exclusive with `set_cycle_id`.
    move_to_active_cycle: bool = Field(default=False)
    #: Posted with no author -- see Comment.author_id.
    comment_body: Optional[str] = None

    created_by_id: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class AutomationRun(SQLModel, table=True):
    """One time a rule matched an issue and changed it.

    This exists so a change nobody remembers making can be traced back to the
    rule that made it. That is the whole feature: automation without a log is
    a tracker that edits itself and will not say why, and the first surprising
    change costs more trust than the rules save in a year.

    Only matches are recorded. A row per rule per event *considered* would
    bury the handful of rows anybody wants under thousands nobody does.

    Two things are denormalised into it, and the asymmetry is deliberate.
    `rule_name` and the summary are copied so the log survives the rule, since
    "which rule did this" is most often asked immediately before deleting the
    rule that did it -- `rule_id` goes null and the row stays readable. The
    issue is *not* denormalised: a log entry about an issue that no longer
    exists is a link to a 404, so those rows go when the issue does, the same
    way its notifications do.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: int = Field(foreign_key="team.id", index=True)
    #: Null once the rule has been deleted. The row stays.
    rule_id: Optional[int] = Field(
        default=None, foreign_key="automationrule.id", index=True
    )
    #: The rule's name as it was when it fired, so a renamed or deleted rule
    #: does not rewrite what the log says it did.
    rule_name: str
    trigger: AutomationTrigger
    issue_id: int = Field(foreign_key="issue.id", index=True)
    #: Who did the thing that fired the rule. Null for a cycle completing
    #: under a scheduled process, and for anything an earlier automation
    #: caused.
    actor_id: Optional[int] = Field(default=None, foreign_key="user.id")
    #: What it actually did, one action per line, in the words the settings
    #: page uses. Written at the time rather than derived on read: a summary
    #: rebuilt from the rule's current columns would describe the rule as it
    #: is now, which is exactly the question the log is not being asked.
    summary: str
    created_at: datetime = Field(default_factory=utcnow, index=True)


class Repository(SQLModel, table=True):
    """A GitHub or GitLab repository one team has connected.

    Connected per team, not per instance. The team is the tenancy boundary
    everywhere else in SoftTrack, and it is what makes the identifier scan
    safe: text arriving from this repository can only ever resolve to issues
    on the team that connected it, so a webhook nobody on the DES team set up
    cannot move a DES issue. A repository two teams both work in is connected
    twice, with a webhook each -- which is more setup, and the alternative is
    one team's CI able to reach another team's board.

    Nothing about the repository's contents is stored. SoftTrack never clones,
    never calls the provider's API and holds no access token: everything it
    knows arrives in a webhook it can verify. That is the difference between
    an integration that needs an OAuth app and a `repo`-scoped token, and one
    that needs a URL and a shared secret.
    """

    __table_args__ = (
        UniqueConstraint("team_id", "full_name", name="uq_repository_team_full_name"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: int = Field(foreign_key="team.id", index=True)
    provider: GitProvider
    #: "owner/name" as the provider writes it, e.g. "acme/api". Compared
    #: against the repository in each payload, so a webhook configured on the
    #: wrong repository is refused rather than quietly linking the wrong
    #: commits.
    full_name: str
    #: The unguessable segment in this connection's webhook URL. It is what
    #: says *which* repository a delivery is for; the signature below is what
    #: says the delivery is genuine. Both are needed, and neither is enough --
    #: knowing the URL does not let you forge a payload, and knowing the
    #: secret does not tell you where to send one.
    hook_token: str = Field(index=True, unique=True)
    #: The shared secret. GitHub HMACs the body with it, GitLab sends it back
    #: verbatim in a header.
    #:
    #: Stored readable, and that is a real cost worth naming: anyone who can
    #: read this table can forge deliveries for this repository, which means
    #: moving issues on its team's board. It cannot be hashed -- an HMAC needs
    #: the key itself, not a digest of it -- so the honest options were this
    #: or a key management service SoftTrack does not have and would not be
    #: self-hostable without. It is scoped to one repository on one team, and
    #: rotating it is one button.
    secret: str
    #: When a verified delivery last arrived. The one thing that distinguishes
    #: "set up correctly" from "set up and never fired", which is otherwise
    #: indistinguishable from the settings page and is what people actually
    #: get wrong.
    last_delivery_at: Optional[datetime] = None
    created_by_id: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=utcnow)


class CodeLink(SQLModel, table=True):
    """One branch, commit or pull request that names an issue.

    Created by the identifier scan, never by hand: the connection between an
    issue and the code that implements it is already written down in the
    branch name and the commit message, and asking somebody to record it a
    second time is how it stops being recorded at all.

    One table with a `kind` rather than three, for the reason IssueEvent gives:
    the read pattern is "everything linked to this issue, in one list", which
    is one query here and a three-way union otherwise, and the columns the
    three kinds do not share are all nullable facts rather than different
    shapes.

    `external_id` is the branch name, the commit sha or the pull request
    number as text -- whatever identifies the thing to its provider. Together
    with the repository and the kind it is unique, which is what makes a
    redelivered webhook update a row instead of adding one.
    """

    __table_args__ = (
        UniqueConstraint(
            "repository_id", "kind", "external_id", "issue_id", name="uq_code_link"
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    issue_id: int = Field(foreign_key="issue.id", index=True)
    repository_id: int = Field(foreign_key="repository.id", index=True)
    kind: CodeLinkKind = Field(index=True)
    external_id: str
    #: The pull request's title or the commit's subject line. Null for a
    #: branch, which is its own title.
    title: Optional[str] = None
    url: str
    #: Pull requests only. Null for branches and commits, which do not have a
    #: state that changes -- a commit is a fact, and a deleted branch is a
    #: fact SoftTrack is not told about reliably enough to display.
    state: Optional[PullRequestState] = None
    #: The provider's name for whoever did it -- a GitHub login, a GitLab
    #: display name. Deliberately not resolved to a SoftTrack user: the
    #: mapping between the two is a guess, and a wrong guess here would put
    #: somebody's face on somebody else's commit.
    author_name: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

"""SQLModel table definitions and the enums that describe their columns.

The Educare backend has no direct counterpart to this module because it talks to
the database in raw SQL. Here the tables *are* the schema, so they live in one
place under `lib_softtrack` and are imported by both the identity and product
service layers.
"""

import enum
from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Column,
    Enum,
    Index,
    UniqueConstraint,
    event,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import SQLModel, Field, Relationship

from lib_utils.password import is_usable_password

#: JSON everywhere, stored as `jsonb` on Postgres: it has equality and
#: containment operators, which is what filtering by a field will need, and
#: plain `json` has neither.
JSONValue = JSON().with_variant(JSONB(), "postgresql")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class StatusCategory(str, enum.Enum):
    """What a status *means*, as opposed to what a team calls it.

    Fixed on purpose, and the reason per-team statuses are safe to allow at
    all. Everything that has to reason about work -- burndown, velocity, "is
    this sprint finished", "3 of 5 sub-tickets done", whether a blocker still
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


class ProjectState(str, enum.Enum):
    """Where a project -- which is what SoftTrack calls an epic -- is in its life.

    Set by hand, like SprintState and for the same reason: "every ticket is
    done" is evidence a project is finished, not a decision that it is. A
    project can be complete with a stray follow-up still open, or have every
    ticket closed and still be waiting on a launch.
    """

    planned = "planned"
    in_progress = "in_progress"
    completed = "completed"
    #: Stopped without being delivered. Distinct from archived, which is about
    #: whether the project is still offered in pickers, not how it ended.
    cancelled = "cancelled"


class TicketGrouping(str, enum.Enum):
    """What the board's columns, and the list's sections, are made of.

    A saved view stores one (#63), so "the planning view" can open grouped by
    project while "my bugs" opens by status. Status is the default because it
    is what the board always was.
    """

    status = "status"
    project = "project"


class TicketType(str, enum.Enum):
    """What kind of work a ticket is (#89).

    A fixed three, deliberately: per-team custom types are how Jira's type
    list grew until nobody could say what a "Sub-task (Technical)" was.

    There is no `epic`. An epic is a Project (#60-#64) -- a grouping of tickets
    with a lead, a target date and progress -- and making it a type as well
    would give the tracker two competing ways to say "these belong together".
    """

    #: Something that does not work as it should.
    bug = "bug"
    #: A piece of work that is not a bug or a user-facing story. The default.
    task = "task"
    #: A change described from the user's side.
    story = "story"


class CustomFieldKind(str, enum.Enum):
    """What a team's own field holds (#117).

    Deliberately few. `user` is the one that motivated the feature -- a QA
    assignee or a reviewer, who is neither the assignee nor a string -- and
    the rest are what a label cannot type-check. Formulas, rollups and
    anything computed are out: a field is a value somebody sets.
    """

    text = "text"
    number = "number"
    select = "select"
    multi_select = "multi_select"
    user = "user"
    date = "date"
    checkbox = "checkbox"
    url = "url"


#: The kinds that choose from the field's own list of options.
OPTION_KINDS = (CustomFieldKind.select, CustomFieldKind.multi_select)


class TicketSort(str, enum.Enum):
    """What the ticket list can be ordered by (#88)."""

    #: When it was filed. The default, and what the list always did.
    created = "created"
    updated = "updated"
    #: Urgent first when descending; "no priority" is the lowest of all.
    priority = "priority"
    #: Largest first when descending. Unsized tickets come last either way.
    estimate = "estimate"
    #: Alphabetical, ignoring case.
    title = "title"
    #: The board's own order, arranged by hand (part 2).
    rank = "rank"


class SortDirection(str, enum.Enum):
    asc = "asc"
    desc = "desc"


class TicketPriority(str, enum.Enum):
    no_priority = "no_priority"
    urgent = "urgent"
    high = "high"
    medium = "medium"
    low = "low"


class TicketLinkType(str, enum.Enum):
    """How one ticket relates to another.

    Only three are stored. "Blocked by" and "duplicated by" are not types --
    they are the same rows read from the other end, which is what keeps the
    two tickets from ever disagreeing about their relationship.

    `relates_to` is symmetric, so it is stored once and shown identically on
    both tickets.
    """

    blocks = "blocks"
    relates_to = "relates_to"
    duplicates = "duplicates"


#: The types where direction carries meaning, and so where the same pair
#: cannot be linked both ways round.
DIRECTED_LINK_TYPES = (TicketLinkType.blocks, TicketLinkType.duplicates)


class SprintState(str, enum.Enum):
    """Where a sprint is in its life.

    Derived from dates would be simpler, but a team that forgets to start a
    sprint on Monday should not have Monday counted against its burndown, and a
    sprint that runs a day long should not silently complete itself and carry
    work away. So the state is set deliberately and the dates are the plan.
    """

    upcoming = "upcoming"
    active = "active"
    completed = "completed"


class SprintOutcome(str, enum.Enum):
    """Whether a sprint's goal was met (#271), said when it is completed."""

    met = "met"
    partly = "partly"
    missed = "missed"


class TicketEventField(str, enum.Enum):
    """Which field a TicketEvent records a change to."""

    status = "status"
    sprint = "sprint"
    estimate = "estimate"
    #: Which project -- epic -- the ticket is in (#64). What makes "how much
    #: did this epic grow after work started" answerable, and scope added late
    #: is what explains most missed dates.
    project = "project"
    #: Who it is assigned to, and how urgent it is (#81). Not charted by any
    #: report -- recorded because they are what people ask the history about:
    #: "who gave me this?", "who made it urgent?".
    assignee = "assignee"
    priority = "priority"
    #: When the ticket is due (#87).
    due_date = "due_date"
    #: Which team it is on, recorded as its key -- `ENG-42` to `OPS-17` (#98).
    #: The key rather than the team id because the key is what changed from
    #: anybody's point of view, and what the Activity feed has to show.
    team = "team"
    #: One of the team's own fields (#117). Which one is the event's
    #: `custom_field_id`; one value for all of them, because the set of
    #: fields is the team's and cannot be an enum.
    custom_field = "custom_field"
    #: Moved to the trash, or restored from it (#323). The new value is when
    #: it went in, as ISO text; restoring writes an empty one.
    trash = "trash"


class DueFilter(str, enum.Enum):
    """The due-date questions the board can be narrowed to (#87).

    Three questions rather than a date range: they are what a standup asks,
    and "this week" means the viewer's week -- the client sends its own
    today, so a filter saved on a Sunday evening in Sydney does not quietly
    mean London's Sunday.
    """

    #: Past its due date and not yet done or cancelled.
    overdue = "overdue"
    #: Due from today to the end of this week (Sunday), done or not.
    this_week = "this_week"
    #: No due date at all.
    none = "none"


class TeamRole(str, enum.Enum):
    """What someone may do inside one team.

    Ordered from most to least power. `guest` (#104) sees everything a member
    sees -- board, list, tickets, comments, sprints, reports, search -- and
    changes nothing: no tickets, no comments, no settings. The one thing a guest
    does write is their own relationship to the team: watching a ticket,
    choosing their own default view, and leaving.
    """

    admin = "admin"
    member = "member"
    guest = "guest"


class ReactionEmoji(str, enum.Enum):
    """The reactions a comment can get (#96) -- GitHub's eight, and only those.

    A fixed set rather than any emoji: no picker to build, no emoji data to
    ship, and a count that means the same thing on every comment. Stored by
    name rather than as the character, so the value is plain ASCII in every
    database and every client, and the glyph is the frontend's business.
    """

    thumbs_up = "thumbs_up"
    thumbs_down = "thumbs_down"
    laugh = "laugh"
    hooray = "hooray"
    confused = "confused"
    heart = "heart"
    rocket = "rocket"
    eyes = "eyes"


class NotificationKind(str, enum.Enum):
    """Why a notification was raised.

    Deliberately about *what happened*, not about how the recipient came to
    care -- "someone commented" reads the same whether you are watching the
    ticket because you filed it or because you were assigned it. Which of
    those is true is not information the inbox has any use for.
    """

    assigned = "assigned"
    mentioned = "mentioned"
    commented = "commented"
    status_changed = "status_changed"
    #: Named in one of the team's user fields (#117) -- set as a ticket's
    #: reviewer or QA assignee. Assignment by another name, told the same
    #: way; `Notification.custom_field_id` says which field.
    field_assigned = "field_assigned"


class AutomationTrigger(str, enum.Enum):
    """What makes an automation rule look at a ticket.

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
    ticket", and this one already exists, already has conditions, and already
    writes down what it did.
    """

    ticket_created = "ticket_created"
    #: The ticket moved to a different column. Conditions are read against the
    #: status it moved *to* -- see AutomationRule.if_status_id.
    status_changed = "status_changed"
    #: Somebody was put on it. Not fired by a ticket being *un*assigned, which
    #: is a different event and leaves nobody to act on.
    ticket_assigned = "ticket_assigned"
    comment_added = "comment_added"
    #: Once per ticket that was in the sprint, after the unfinished work has
    #: carried over -- see lib_softtrack/sprints.py.
    sprint_completed = "sprint_completed"

    #: A branch naming this ticket appeared. Fires the first time the branch is
    #: seen, not on every push to it.
    branch_created = "branch_created"
    #: A pull or merge request naming this ticket was opened.
    pull_request_opened = "pull_request_opened"
    #: ...and merged. Closed-without-merging is not this trigger: the work did
    #: not ship, and a rule moving the ticket to Done would be wrong about the
    #: one thing it is for.
    pull_request_merged = "pull_request_merged"


class GitProvider(str, enum.Enum):
    github = "github"
    gitlab = "gitlab"


class OAuthProvider(str, enum.Enum):
    """An identity provider somebody can sign in with.

    Two, and closed on purpose. Each one is a different set of quirks rather
    than a row of configuration -- see `lib_identity/oauth_providers.py` -- and
    a self-hosted instance that configures neither keeps email and password
    with no external dependency at all. Unrelated to `GitProvider`: that is a
    repository SoftTrack is told about, this is a way into an account.
    """

    google = "google"
    github = "github"


class CodeLinkKind(str, enum.Enum):
    """What kind of thing in a repository is linked to a ticket."""

    branch = "branch"
    commit = "commit"
    #: A GitHub pull request or a GitLab merge request. One name here because
    #: they are the same object with two vendors' words for it, and a ticket
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


class PaySchedule(str, enum.Enum):
    """How often somebody is paid (#131). A compensation amount is per pay
    period of its schedule -- a month, half a month, two weeks -- so a monthly
    and a bi-weekly amount are never added together, and nothing is
    annualised behind anybody's back."""

    monthly = "monthly"
    semi_monthly = "semi_monthly"
    bi_weekly = "bi_weekly"


class PayrollRunState(str, enum.Enum):
    """Where a payroll run is (#132).

    Set by a finance admin, never derived, for the reason a sprint's state is
    set: the dates are the plan, the state is what happened. Forward only. A
    mistake found after approval is put right on the next run, which is how
    payroll corrections are made anyway, and an approved run stays what it
    said it paid.
    """

    draft = "draft"
    approved = "approved"
    paid = "paid"


class ExpenseState(str, enum.Enum):
    """Where an expense claim is (#133).

    One submitter, one decision, by a finance admin -- never by the manager
    chain, which stays information (#124). A refusal carries its reason.
    Whatever happens to an approved claim next -- a batch, a line on a
    payroll run -- is reimbursement's (#137), and reads from these rows.
    """

    submitted = "submitted"
    approved = "approved"
    refused = "refused"


class CompensationKind(str, enum.Enum):
    """What decision a compensation record is (#131).

    `raise_` because `raise` is a keyword; the value, which is what the API
    and the database hold, is "raise". A correction names the record it
    corrects, and nothing else does.
    """

    hire = "hire"
    raise_ = "raise"
    correction = "correction"
    other = "other"


# ---------------------------------------------------------------------------
# Link tables
# ---------------------------------------------------------------------------


class TeamMember(SQLModel, table=True):
    team_id: int = Field(foreign_key="team.id", primary_key=True)
    user_id: int = Field(foreign_key="user.id", primary_key=True)
    role: TeamRole = Field(default=TeamRole.member)
    joined_at: datetime = Field(default_factory=utcnow)


class GuestEpic(SQLModel, table=True):
    """An epic an account from outside the organisation may see (#243).

    Its membership's reach on that team: the tickets in these epics, and
    nothing else. No row means no tickets. The team is the epic's, so a row
    needs no team of its own; leaving the team takes that team's rows with
    it, and so does the epic being purged from the trash.
    """

    user_id: int = Field(foreign_key="user.id", primary_key=True)
    project_id: int = Field(foreign_key="project.id", primary_key=True, index=True)


class TicketLabelLink(SQLModel, table=True):
    ticket_id: int = Field(foreign_key="ticket.id", primary_key=True)
    label_id: int = Field(foreign_key="label.id", primary_key=True)


# ---------------------------------------------------------------------------
# Core tables
# ---------------------------------------------------------------------------


class Department(SQLModel, table=True):
    """A named group people belong to, defined once by a site admin (#123).

    A row rather than free text on the profile: a department typed by hand is
    a department spelled four ways, and the people directory filters by it.
    Renaming one renames it for everybody in it, which is the point of it
    being a row.

    Flat on purpose -- no parent department, no head, no permissions. Those
    are org-chart features that can arrive if they earn it; a named list is
    what the directory and its filters need.
    """

    __table_args__ = (UniqueConstraint("name_key", name="uq_department_name_key"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    #: `name` case-folded, which is what makes two names the same one. Unique,
    #: so "engineering" cannot join "Engineering" even when two admins create
    #: them at once. A column rather than an index on `lower(name)`: SQLite's
    #: lower() folds ASCII only, and SQLAlchemy cannot reflect an expression
    #: index there, so every later migration touching `user` would warn.
    name_key: str
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)


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
    #: Deactivated rather than deleted. Tickets, comments and history all carry
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

    # --- What the organisation knows about them (#122) ---------------------
    # Every one nullable: an instance that never fills them in looks exactly
    # as it did before they existed. Title and location are the person's own
    # to edit; the start date is set by a site admin, because it is a fact
    # the organisation owns rather than one the person does.

    #: Free text, in their own words. A fixed list of titles is an HR
    #: system's job; the directory only has to show it.
    job_title: Optional[str] = None
    #: Where they work from: a city, an office, "Remote". Free text for the
    #: same reason.
    location: Optional[str] = None
    #: A date rather than a datetime, like a ticket's due date: a start is a
    #: day, and a timestamp would move it across midnight for anybody in
    #: another timezone.
    started_on: Optional[date] = None
    #: Set by a site admin (#123). Deleting a department with people in it
    #: asks where they go, so this never dangles and never silently empties.
    department_id: Optional[int] = Field(
        default=None, foreign_key="department.id", index=True
    )
    department: Optional[Department] = Relationship()
    #: Who they report to (#124), set by a site admin. Information, not
    #: authority: nothing is permitted or approved because of it. Never a
    #: loop -- `lib_identity/managers.py` walks the chain before it is set --
    #: and left in place when the manager is deactivated, where the admin
    #: directory lists it rather than letting it go quietly stale.
    manager_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    manager: Optional["User"] = Relationship(
        sa_relationship_kwargs={
            "remote_side": "User.id",
            # Named, because the finance grant below is a second link from
            # a user to a user and the join would otherwise be ambiguous.
            "foreign_keys": "User.manager_id",
        }
    )

    # --- Finance access (#130) ---------------------------------------------

    #: Whether they can see money at all: pay, payroll runs, everybody's
    #: expense claims, budgets and the finance reports. Every endpoint under
    #: /finance checks it (`lib_finance/access.py`). Granted by a site admin
    #: and separate from being one: the site admin is the IT role, and
    #: resetting somebody's password says nothing about reading their salary.
    #: Neither flag includes the other.
    is_finance_admin: bool = Field(default=False)
    #: When the access they hold now was granted, and by whom. Both cleared
    #: when it is revoked; the history is the log's (see lib_finance/access.py).
    finance_admin_since: Optional[datetime] = None
    finance_admin_granted_by_id: Optional[int] = Field(
        default=None, foreign_key="user.id"
    )
    #: Read-only: the grant is written through the id. A site admin may
    #: grant it to themselves, and a row pointing at itself through a
    #: writable relationship is a cycle SQLAlchemy refuses to flush.
    finance_admin_granted_by: Optional["User"] = Relationship(
        sa_relationship_kwargs={
            "remote_side": "User.id",
            "foreign_keys": "User.finance_admin_granted_by_id",
            "viewonly": True,
        }
    )

    # --- Outside the organisation (#243) -----------------------------------

    #: An account from outside: a client, a contractor's client, a partner.
    #: Set on the invitation that created it or by a site admin, never by the
    #: person. On a team it is only ever a guest, and it sees the tickets of
    #: the epics it was given there and nothing else (`lib_softtrack/
    #: outside.py`). Never a site or finance admin.
    is_external: bool = Field(default=False)

    @property
    def has_password(self) -> bool:
        """Whether this account can be signed into with a password.

        False for one created by signing in with Google or GitHub, which is
        stored with an unusable hash rather than a nullable column -- see
        `lib_utils/password.py`. A property rather than a column because it is
        a reading of `hashed_password`, and a second copy of the same fact is
        a second thing to keep true.
        """
        return is_usable_password(self.hashed_password)


class UserIdentity(SQLModel, table=True):
    """A Google or GitHub account that may sign in as this user.

    A row rather than a pair of columns on `User`, because the same person can
    have both -- and because the interesting question is always "whose account
    is this provider identity?", which is an index on `(provider, subject)`
    and not a scan of two nullable columns.

    `subject` is the provider's own id for the account, never the address. An
    address changes, gets reassigned inside a company, and on GitHub can be
    made private; the numeric id does none of those. Matching on the address
    would mean that somebody who inherits a departed colleague's mailbox
    inherits their SoftTrack account with it.
    """

    __table_args__ = (
        # One provider account signs in as exactly one user...
        UniqueConstraint("provider", "subject", name="uq_user_identity_subject"),
        # ...and one user has at most one account per provider. Without this,
        # connecting twice with two different Google accounts leaves two keys
        # to the same door, `DELETE /auth/me/identities/{provider}` has no way
        # to say which it removed, and the "would this leave you locked out"
        # check miscounts.
        UniqueConstraint("user_id", "provider", name="uq_user_identity_provider"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    provider: OAuthProvider
    #: The provider's immutable id for the account. Text rather than an
    #: integer: GitHub's is numeric and Google's is not.
    subject: str = Field(index=True)
    #: The address the provider reported when the link was made, kept for the
    #: connected-accounts list so somebody with two Google accounts can tell
    #: which one this is. Never used to resolve a sign-in.
    email: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    last_login_at: Optional[datetime] = None


class WebhookEvent(str, enum.Enum):
    """What an outbound webhook can be sent (#91).

    The same happenings the notification system already observes, named the
    way most senders name theirs: `resource.verb`.
    """

    ticket_created = "ticket.created"
    #: Any change to a ticket's fields. A status change sends this *and*
    #: `ticket.status_changed`, so a consumer can listen to only the latter.
    ticket_updated = "ticket.updated"
    ticket_status_changed = "ticket.status_changed"
    #: Moved to the trash, and back out of it (#323). Purging sends nothing:
    #: by then the ticket has been gone from every consumer's point of view
    #: for as long as the trash keeps things.
    ticket_deleted = "ticket.deleted"
    ticket_restored = "ticket.restored"
    comment_created = "comment.created"
    sprint_started = "sprint.started"
    sprint_completed = "sprint.completed"
    #: Sent on request from the settings page, to check a URL works.
    ping = "ping"


class OutboundWebhook(SQLModel, table=True):
    """A URL a team's events are posted to (#91). Managed by team admins."""

    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: int = Field(foreign_key="team.id", index=True)
    url: str
    #: The HMAC key for X-SoftTrack-Signature. Kept as given -- signing needs
    #: the key itself, unlike a credential that only has to be checked -- and
    #: shown once, when the webhook is made.
    secret: str
    #: The subscribed WebhookEvent values, comma-separated. A short fixed set,
    #: read and written only through lib_softtrack/outbound.py.
    events: str
    is_enabled: bool = Field(default=True)
    #: Deliveries in a row that failed after every retry. Reset by a success.
    consecutive_failures: int = Field(default=0)
    #: Why it was switched off automatically; null if it was not.
    disabled_reason: Optional[str] = None
    created_by_id: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=utcnow)


class WebhookDelivery(SQLModel, table=True):
    """One event on its way to one webhook, and what happened to it (#91).

    Written in the same transaction as the change it reports -- an outbox --
    so an event is never lost to a crash between the change and the send, and
    the send happens later, off the request. The same rows are the delivery
    log the settings page shows, like AutomationRun is for rules.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    webhook_id: int = Field(foreign_key="outboundwebhook.id", index=True)
    event: str
    #: The exact JSON body, fixed when the event happened, so every retry
    #: sends -- and signs -- the same bytes.
    payload: str
    #: pending, succeeded or failed.
    status: str = Field(default="pending", index=True)
    attempts: int = Field(default=0)
    #: When the next attempt is due; null once it has succeeded or given up.
    next_attempt_at: Optional[datetime] = Field(default=None, index=True)
    #: A worker's hold on the row while it sends, so two processes never
    #: send the same delivery. See outbound._claim.
    claimed_until: Optional[datetime] = None
    response_status: Optional[int] = None
    #: The start of the response body, or the error, for debugging from the UI.
    response_excerpt: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow, index=True)
    completed_at: Optional[datetime] = None


class ApiToken(SQLModel, table=True):
    """A personal API token, for scripts and integrations (#90).

    Acts as its owner, with its owner's permissions -- there are no scopes
    yet. Only a SHA-256 hash of the secret is stored: the secret is shown
    once, when the token is made, and a leaked backup holds nothing usable.
    Hashing needs no salt or slow hash because the secret is 256 random bits.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    name: str
    token_hash: str = Field(index=True, unique=True)
    #: The secret's last four characters, so a person can tell which token a
    #: leak is -- "softtrack_...Xy3Q" -- without the secret being kept.
    hint: str
    created_at: datetime = Field(default_factory=utcnow)
    #: Updated at most once a minute; a busy script would otherwise write a
    #: row on every request just to say it is still busy.
    last_used_at: Optional[datetime] = None
    #: Null means it does not expire.
    expires_at: Optional[datetime] = None


class PasswordReset(SQLModel, table=True):
    """A pending "forgot password" link (#83).

    Shaped like TeamInvite -- a row that disappears once it has been used --
    with one difference: only a SHA-256 hash of the token is stored. The
    token *is* the credential, for as long as the row lives, and a leaked
    backup or a read-only SQL injection should not hand out working links.
    Hashing is enough without a salt or a slow hash because the token is 256
    random bits, not something a person chose.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    token_hash: str = Field(index=True, unique=True)
    #: The account's `token_version` when the link was requested. Changing the
    #: password any other way, or signing out everywhere, moves it on -- and
    #: with it every link still sitting in an inbox.
    token_version: int
    created_at: datetime = Field(default_factory=utcnow)
    expires_at: datetime


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
    #: For somebody outside the organisation (#243): the account it creates
    #: is external, and its membership reaches only `epic_ids`, this team's
    #: epics as they were chosen. Checked again on acceptance, so an epic
    #: deleted in between is simply not given.
    external: bool = Field(default=False)
    epic_ids: list[int] = Field(
        default_factory=list, sa_column=Column(JSONValue, nullable=False)
    )
    #: When the current link was emailed to the address (#84), or null if it
    #: never was. "Attempted", not "delivered": SMTP accepting a message is
    #: all this instance can know. Cleared when a re-invite mints a new link
    #: without emailing it, because the link in the old email no longer works.
    emailed_at: Optional[datetime] = None


class Team(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    key: str = Field(index=True, unique=True, description="Short prefix, e.g. ENG")
    description: Optional[str] = None
    next_ticket_number: int = Field(default=1)
    next_sprint_number: int = Field(default=1)
    #: The view everyone on this team lands on, unless they have chosen their
    #: own -- see UserDefaultView. Only a shared view may hold it, since a
    #: private one would be invisible to everybody it was defaulted for.
    #:
    #: A column here rather than a flag on SavedView so that "at most one
    #: default" is a fact about the schema instead of an invariant the service
    #: has to keep re-establishing.
    default_view_id: Optional[int] = Field(default=None, foreign_key="savedview.id")
    #: Whether any member may delete any ticket or epic (#323), or only its
    #: creator -- an epic's lead -- and the team's admins. False for a new
    #: team; the teams there were before the trash keep True, which is what
    #: deleting always was.
    any_member_may_delete: bool = Field(default=False)
    #: Whether the team's guests may join the conversation (#244): comment,
    #: attach files to their comments, react, and edit or delete their own.
    #: They still change nothing else. Off unless a team admin turns it on.
    guests_may_comment: bool = Field(default=False)
    #: What a status's WIP limit means (#270): False, the board warns when a
    #: column goes over; True, a move that would take it over is refused.
    wip_limits_hard: bool = Field(default=False)
    #: Whether sub-tickets count against a column's limit, or only the work
    #: they are part of.
    wip_counts_subtickets: bool = Field(default=True)
    created_at: datetime = Field(default_factory=utcnow)


class Project(SQLModel, table=True):
    """A group of tickets working towards one outcome. An epic, in Jira terms.

    The Jira importer maps `Epic Link` here, and there is deliberately no
    separate Epic entity: projects, `parent_id` and sprints already group
    tickets three ways, and a fourth that overlapped them would be sprawl.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: int = Field(foreign_key="team.id", index=True)
    name: str
    description: Optional[str] = None
    color: str = Field(default="#6366f1")
    #: The one person answerable for it. A team member, checked on write.
    lead_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    #: A date rather than a datetime: a target is a day, and a timestamp would
    #: shift it across midnight for anybody in another timezone.
    target_date: Optional[date] = None
    state: ProjectState = Field(default=ProjectState.planned)
    #: Retired from the pickers, not deleted. Tickets that already point here
    #: keep pointing here, and the project still reads back by id and in the
    #: team's list, so nothing that references it goes blank.
    archived: bool = Field(default=False)
    created_at: datetime = Field(default_factory=utcnow)
    #: In the trash since (#323), and who put it there. Its tickets keep
    #: pointing here, so they rejoin it when it is restored.
    deleted_at: Optional[datetime] = Field(default=None, index=True)
    deleted_by_id: Optional[int] = Field(default=None, foreign_key="user.id")


def label_name_key(name: str) -> str:
    """What makes two label names the same label: `Label.name_key`."""
    return name.strip().casefold()


class Label(SQLModel, table=True):
    #: One label per name on a team, whatever the case (#321), so "feature"
    #: cannot join "Feature" even when two people add it at once.
    __table_args__ = (
        UniqueConstraint("team_id", "name_key", name="uq_label_team_name_key"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: int = Field(foreign_key="team.id", index=True)
    name: str
    color: str = Field(default="#94a3b8")
    #: `name` trimmed and case-folded. A column rather than an index on
    #: `lower(name)`, as with `Department.name_key`. Kept in step with `name`
    #: by `_keep_label_name_key` on every insert and update, so a caller that
    #: only sets the name cannot leave it stale.
    name_key: str = Field(default="")


@event.listens_for(Label, "before_insert")
@event.listens_for(Label, "before_update")
def _keep_label_name_key(_mapper, _connection, label: Label) -> None:
    label.name_key = label_name_key(label.name)


class Ticket(SQLModel, table=True):
    __table_args__ = (Index("ix_ticket_team_number", "team_id", "number", unique=True),)

    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: int = Field(foreign_key="team.id", index=True)
    project_id: Optional[int] = Field(
        default=None, foreign_key="project.id", index=True
    )
    number: int
    title: str
    description: Optional[str] = None
    #: The team's own status row, not a fixed enum. What the ticket *means* --
    #: started, done -- is the status's category; see StatusCategory.
    status_id: int = Field(foreign_key="workflowstatus.id", index=True)
    priority: TicketPriority = Field(default=TicketPriority.no_priority)
    type: TicketType = Field(default=TicketType.task, index=True)
    #: Where it sits on the board, as a fractional-indexing key compared by
    #: code point -- see lib_softtrack/ranks.py. Set on creation (top of the
    #: team) and by dragging; nothing else touches it.
    rank: str = Field(default="", index=True)
    assignee_id: Optional[int] = Field(default=None, foreign_key="user.id")
    # One level of nesting only -- a ticket with a parent may not itself be a
    # parent. See lib_softtrack/subtickets.py for why that limit is enforced
    # rather than left to convention.
    parent_id: Optional[int] = Field(default=None, foreign_key="ticket.id", index=True)
    sprint_id: Optional[int] = Field(default=None, foreign_key="sprint.id", index=True)
    #: The identifier this ticket had in the system it was imported from, e.g.
    #: a Jira key like "PROJ-142". Kept so links in old documents, commit
    #: messages and chat history stay traceable after a migration -- which is
    #: most of what makes a migration survivable.
    external_key: Optional[str] = Field(default=None, index=True)
    creator_id: int = Field(foreign_key="user.id")
    # Story points. Null means "not sized yet", which is a different thing
    # from zero -- a burndown has to be able to tell them apart.
    estimate: Optional[int] = Field(default=None)
    #: When it is due (#87). A date rather than a datetime, like a project's
    #: target: "due Friday" is a day, and a timestamp would move it across
    #: midnight for anybody in another timezone.
    due_date: Optional[date] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    #: In the trash since (#323), and who put it there. A trashed ticket keeps
    #: everything -- comments, links, attachments, history -- and is left out
    #: of every query that does not ask for it (`lib_softtrack.trash`), until
    #: it is restored or purged.
    deleted_at: Optional[datetime] = Field(default=None, index=True)
    deleted_by_id: Optional[int] = Field(default=None, foreign_key="user.id")


class TicketLink(SQLModel, table=True):
    """A relationship between two tickets, stored once and read from both ends.

    The unique constraint is what enforces "no duplicate links" -- doing it in
    the database rather than only in the service means two simultaneous
    requests cannot both pass a check-then-insert and create a pair of
    identical rows.
    """

    __table_args__ = (
        UniqueConstraint("source_id", "target_id", "type", name="uq_ticket_link"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    source_id: int = Field(foreign_key="ticket.id", index=True)
    target_id: int = Field(foreign_key="ticket.id", index=True)
    type: TicketLinkType
    created_by_id: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=utcnow)


class Sprint(SQLModel, table=True):
    """A time-boxed iteration belonging to one team."""

    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: int = Field(foreign_key="team.id", index=True)
    #: Per team, and stable: "Sprint 7" keeps meaning the same fortnight after
    #: another sprint is deleted, which a positional index would not.
    number: int
    name: Optional[str] = None
    starts_at: datetime
    ends_at: datetime
    state: SprintState = Field(default=SprintState.upcoming, index=True)
    completed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)

    # --- What it was for, and what the team learned (#271) ------------------

    #: A sentence or two, written when the sprint is planned.
    goal: Optional[str] = None
    #: Whether the goal was met, said when it is completed or after.
    goal_outcome: Optional[SprintOutcome] = None
    #: The retrospective: three markdown sections, any of them filled in when
    #: the sprint is completed or later, by anybody on the team but a guest,
    #: until a team admin closes it.
    retro_went_well: Optional[str] = None
    retro_did_not: Optional[str] = None
    retro_to_change: Optional[str] = None
    retro_closed_at: Optional[datetime] = None


class SprintAction(SQLModel, table=True):
    """Something to change, from a sprint's retrospective, made a ticket (#271).

    The line it came from and the ticket it became, so the retrospective can
    show which of its actions became work and the ticket can say where it
    came from.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    sprint_id: int = Field(foreign_key="sprint.id", index=True)
    ticket_id: int = Field(foreign_key="ticket.id", index=True)
    text: str
    created_at: datetime = Field(default_factory=utcnow)


class TicketEvent(SQLModel, table=True):
    """One recorded change to a ticket field.

    This table is why reporting is possible at all. A burndown asks what the
    board looked like on the ninth of the month, and no amount of querying the
    current rows can answer that -- the history is simply gone unless it was
    written down as it happened. Every day this table does not exist is a day
    that can never be charted.

    Deliberately generic (field/old/new as text) rather than one table per
    field. The alternative is a new table and a new migration every time
    something else turns out to be worth charting, and the read patterns --
    "changes to this ticket, in order" -- are identical whatever the field.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(foreign_key="ticket.id", index=True)
    #: Denormalised from the ticket so a report can filter a date range by team
    #: without joining, and so the row survives as history if the ticket moves.
    team_id: int = Field(foreign_key="team.id", index=True)
    field: TicketEventField = Field(index=True)
    #: Null on the creation event for a field, and for a value being cleared.
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    actor_id: Optional[int] = Field(default=None, foreign_key="user.id")
    created_at: datetime = Field(default_factory=utcnow, index=True)
    #: The value a field started with, written when the ticket was created or
    #: imported -- not a change to it. The reports need these (a chart has to
    #: know where a ticket began); the Activity feed leaves them out (#81).
    #: Marked when written rather than inferred afterwards: "old value null,
    #: soon after creation" also describes a real change made quickly, such
    #: as an automation assigning a new ticket.
    opening: bool = Field(default=False)
    #: Which of the team's own fields changed, when `field` is `custom_field`
    #: (#117); null for every built-in field. The values are the field's own
    #: -- see lib_softtrack/custom_fields.py for how each kind is written.
    custom_field_id: Optional[int] = Field(
        default=None, foreign_key="customfield.id", index=True
    )


class Comment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(foreign_key="ticket.id", index=True)
    #: Null when an automation rule wrote it. The alternative was to author
    #: those as whoever happened to trip the rule, which puts words in a
    #: person's mouth on the one kind of comment nobody wrote -- and the
    #: comment most likely to be argued with. `Notification.actor_id` is
    #: nullable for the same event and the same reason.
    author_id: Optional[int] = Field(default=None, foreign_key="user.id")
    body: str
    created_at: datetime = Field(default_factory=utcnow)
    #: When the body last changed (#93), or null if it never has. Only the
    #: latest edit is kept -- enough for an "(edited)" marker, and no promise
    #: of a history that nothing reads.
    edited_at: Optional[datetime] = None


class Worklog(SQLModel, table=True):
    """Time somebody spent on a ticket, on one day (#102).

    Minutes as an integer rather than an interval type: every question asked
    of this table is a sum, and integers sum exactly and identically on SQLite
    and Postgres. One entry is one day's work -- which is why it has a date
    and why it is capped at a day -- so "2h yesterday, 3h today" is two rows
    and a report by date is a `GROUP BY` rather than a guess about how a
    three-day entry should be spread.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(foreign_key="ticket.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    minutes: int
    #: The day the work happened, in the logger's own calendar. Defaults to
    #: their today; worth changing for "I forgot to log Friday".
    worked_on: date = Field(index=True)
    note: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class TicketTemplate(SQLModel, table=True):
    """A starting point for a new ticket's description (#97).

    Per team and admin-managed: "Bug report" means repro steps on one team and
    a customer ticket number on another. Only the description -- a default
    assignee, labels or priority is what automation rules are for, and a
    template that set them would be a second engine for the same job.

    Choosing one fills the description field and nothing else holds on to it:
    the ticket does not remember which template it came from, so editing or
    deleting a template never changes a ticket that already exists.
    """

    __table_args__ = (
        UniqueConstraint("team_id", "name", name="uq_ticket_template_team_name"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: int = Field(foreign_key="team.id", index=True)
    name: str
    body: str
    #: The picker's order, which admins set.
    position: int = 0
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class CustomField(SQLModel, table=True):
    """A field a team adds to its own tickets (#117): a reviewer, an environment.

    Team-scoped and never global -- two teams may both have "Reviewer" and
    mean different people by it. Tickets carry values in CustomFieldValue;
    this row is the definition the form, the panel and the export read.

    `key` is what the API calls it (`"custom_fields": {"reviewer": 12}`) and
    never changes once made, so a script written against it keeps working
    after the name is reworded. `kind` never changes either: a value written
    as a date means nothing read as a person.
    """

    __table_args__ = (
        UniqueConstraint("team_id", "key", name="uq_custom_field_team_key"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: int = Field(foreign_key="team.id", index=True)
    key: str
    name: str
    kind: CustomFieldKind
    #: For `select` and `multi_select`: `[{"id": "production", "name":
    #: "Production"}, ...]`, in the order offered. An option's id is made from
    #: its first name and kept through renames, so values -- which store the
    #: id -- survive the option being reworded. Empty for every other kind.
    options: list = Field(
        default_factory=list, sa_column=Column(JSONValue, nullable=False)
    )
    #: Enforced when a ticket is filed, with an error that names the field.
    required: bool = Field(default=False)
    #: The ticket types it shows on (#89); empty is all of them. The
    #: difference between Environment on every task and Environment on bugs.
    applies_to: list = Field(
        default_factory=list, sa_column=Column(JSONValue, nullable=False)
    )
    #: Order in the ticket panel, the form and the export, low to high.
    position: int = 0
    #: Hidden from the form and the panel's editors; values stay readable.
    #: Deleting is a separate step, and only from here -- it destroys history.
    archived_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)


class CustomFieldValue(SQLModel, table=True):
    """One ticket's value for one of its team's fields (#117).

    One JSON `value` rather than a nullable column per kind: the kind on the
    field says how to read it, the service validates it on the way in, and a
    ninth kind is not a migration. The cost is that filtering has to reach
    into JSON -- `jsonb` on Postgres, where that is cheap to index. A field
    with no value has no row: clearing one deletes it.
    """

    __table_args__ = (
        UniqueConstraint("ticket_id", "field_id", name="uq_custom_field_value"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(foreign_key="ticket.id", index=True)
    field_id: int = Field(foreign_key="customfield.id", index=True)
    #: A string, number, bool, option id, list of option ids, ISO date or
    #: user id, by the field's kind.
    value: object = Field(sa_column=Column(JSONValue, nullable=False))
    updated_at: datetime = Field(default_factory=utcnow)


class CommentReaction(SQLModel, table=True):
    """One person's one reaction to one comment (#96).

    The primary key is the whole row, the way `TicketLabelLink` is: the same
    person can give a comment several different reactions, and never the same
    one twice. That is also what makes adding one idempotent -- a double click
    is a second insert of a row that exists.
    """

    comment_id: int = Field(foreign_key="comment.id", primary_key=True)
    user_id: int = Field(foreign_key="user.id", primary_key=True)
    emoji: ReactionEmoji = Field(primary_key=True)
    created_at: datetime = Field(default_factory=utcnow)


class Attachment(SQLModel, table=True):
    """One uploaded file. The bytes live in storage; this is the metadata.

    Every attachment belongs to a ticket, and *optionally* to one comment on
    that ticket. Two reasons for the ticket_id being mandatory rather than one
    nullable owner column: it is the only path to a team, so it is what every
    permission check reads; and it is what makes deleting a ticket able to
    clean up in one query rather than walking its comments.

    A file is uploaded before the comment it belongs to exists -- you paste a
    screenshot, then write the sentence about it -- so it starts with
    comment_id null and the comment claims it on submit.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(foreign_key="ticket.id", index=True)
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
    #: Uploaded by a guest (#244), who attaches files to their comments and
    #: to nothing else: until a comment claims it, the file is a draft and not
    #: one of the ticket's. Recorded at upload, so a member later made a guest
    #: keeps the files they put on tickets.
    guest_draft: bool = Field(default=False)
    created_at: datetime = Field(default_factory=utcnow)


class TicketWatch(SQLModel, table=True):
    """Whether one person is following one ticket.

    A row exists as soon as SoftTrack has an opinion about someone and a
    ticket, and `watching` says which way. Storing "no" rather than deleting
    the row is the whole point: creating, commenting on or being assigned a
    ticket auto-watches it, so a deleted row would be silently recreated by the
    next thing the person did and the unwatch would not survive the afternoon.
    A mute that does not stick is not a mute.
    """

    ticket_id: int = Field(foreign_key="ticket.id", primary_key=True)
    user_id: int = Field(foreign_key="user.id", primary_key=True)
    watching: bool = Field(default=True)
    created_at: datetime = Field(default_factory=utcnow)


class Notification(SQLModel, table=True):
    """One thing that happened, addressed to one person.

    A row per recipient rather than one event fanned out at read time. The
    read/unread state belongs to the person, not to the event, and so does
    "which of these have already been emailed" -- both of which a shared event
    row would have to carry in a side table keyed by exactly this pair.

    Nothing about the event is denormalised into it. The ticket's title and the
    comment's body are read through the foreign keys when the inbox is built,
    so a ticket renamed after the fact shows up under the name it has now,
    which is the one the reader will recognise.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    #: Who is being told. Indexed with `read_at` because every read of this
    #: table is "my unread ones" or "my recent ones".
    user_id: int = Field(foreign_key="user.id", index=True)
    kind: NotificationKind
    ticket_id: int = Field(foreign_key="ticket.id", index=True)
    #: Set when the event was a comment, so the inbox can quote it and link
    #: straight to it. Null for assignment and status changes.
    comment_id: Optional[int] = Field(
        default=None, foreign_key="comment.id", index=True
    )
    #: Who did it. Nullable because an importer or a future automation has no
    #: user behind it, and "Jira import assigned this to you" is still worth
    #: saying.
    actor_id: Optional[int] = Field(default=None, foreign_key="user.id")
    #: The field somebody was named in, for `field_assigned` (#117). Read
    #: through, like the ticket's title, so a renamed field reads as it is now.
    custom_field_id: Optional[int] = Field(
        default=None, foreign_key="customfield.id", index=True
    )
    read_at: Optional[datetime] = Field(default=None, index=True)
    #: When this row went out in a digest. Set *before* the mail is sent and
    #: only on rows the update actually claimed, so two processes running the
    #: digest loop cannot both send the same notification.
    emailed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow, index=True)


class SavedView(SQLModel, table=True):
    """A named set of filters over one team's tickets.

    The filters are columns rather than a JSON blob. The set is small, fixed
    and already described by enums the API publishes, so columns get typed
    request and response models -- and therefore a typed frontend client --
    where a blob would reach the browser as `unknown`. Foreign keys also mean
    a view cannot outlive the label or sprint it filters on without somebody
    having to decide what happens, which is the conversation a blob quietly
    skips.

    Every field is nullable and null means "no opinion", so a view with
    nothing set is "all tickets" rather than a contradiction that matches
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
    priority: Optional[TicketPriority] = None
    assignee_id: Optional[int] = Field(default=None, foreign_key="user.id")
    #: Distinct from `assignee_id is None`, which means "any assignee". The two
    #: are mutually exclusive and the request model rejects setting both.
    unassigned: bool = Field(default=False)
    label_id: Optional[int] = Field(default=None, foreign_key="label.id")
    project_id: Optional[int] = Field(default=None, foreign_key="project.id")
    #: Cleared when the sprint is deleted -- see lib_softtrack/sprints.py. A view
    #: pointing at a sprint that no longer exists would match nothing and look
    #: broken rather than empty.
    sprint_id: Optional[int] = Field(default=None, foreign_key="sprint.id")
    due: Optional[DueFilter] = None
    type: Optional[TicketType] = None

    #: Not a filter -- it narrows nothing -- but part of what a view *is*: the
    #: same tickets read very differently by column and by project.
    group_by: TicketGrouping = Field(default=TicketGrouping.status)
    #: How the list is ordered (#88). Null is the default, newest first --
    #: which is what every view saved before this column existed showed.
    sort: Optional[TicketSort] = None
    sort_direction: Optional[SortDirection] = None

    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class ShareLink(SQLModel, table=True):
    """A read-only link to an epic or a saved view, for somebody with no
    account (#245): a client opening it on Monday morning to see what moved.

    The link is a token, and only its hash is kept, the way a password reset
    token is: a copy of the database opens nothing. It can expire, can ask
    for a password, and is revoked rather than deleted, so the list of a
    team's links still says who made one and how often it was opened.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: int = Field(foreign_key="team.id", index=True)
    #: What it shows: an epic, or a saved view. Exactly one, until what it
    #: pointed at goes -- then neither, and the link is revoked with it.
    project_id: Optional[int] = Field(default=None, foreign_key="project.id")
    view_id: Optional[int] = Field(default=None, foreign_key="savedview.id")
    #: sha256 of the token. The token itself is shown once, when made.
    token_hash: str = Field(index=True, unique=True)
    created_by_id: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=utcnow)
    expires_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None
    #: A password whoever opens it has to give as well, hashed like an
    #: account's. Null for none.
    password_hash: Optional[str] = None
    #: What the page shows beside key, title, status and type. All off unless
    #: the link turns them on.
    show_comments: bool = Field(default=False)
    show_assignees: bool = Field(default=False)
    show_estimates: bool = Field(default=False)
    show_attachments: bool = Field(default=False)
    open_count: int = Field(default=0)
    last_opened_at: Optional[datetime] = None


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

    Replaces the fixed `TicketStatus` enum. A team can add "Blocked" or "QA"
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
    #: How many tickets the column should hold at once (#270), or null for
    #: no limit. Over it, the board says so; where the team makes limits hard
    #: (`Team.wip_limits_hard`), a move that would go over is refused.
    wip_limit: Optional[int] = None
    created_at: datetime = Field(default_factory=utcnow)


class AutomationRule(SQLModel, table=True):
    """One trigger, some conditions, some actions -- scoped to a team.

    The shape is columns rather than a JSON blob, for the reasons SavedView
    gives: the vocabulary is small and fixed, the API publishes it as enums,
    and a typed frontend falls out of that where a blob would arrive in the
    browser as `unknown`. The foreign keys also mean a rule cannot quietly
    outlive the status or sprint it names -- deleting one of those has to
    decide what happens to the rule, which is the conversation a blob skips.

    **Conditions** are the `if_*` columns, ANDed, with null meaning "no
    opinion". A rule with none of them set fires on every event of its
    trigger, which is what an unconditioned rule should do. They are the same
    vocabulary a saved view filters on, deliberately: a team that can describe
    the tickets it means in the filter bar can describe them here.

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
    #: For `status_changed`, the status the ticket moved *to*. For every other
    #: trigger, the status it is in when the rule looks at it -- which is the
    #: same column read the same way, so there is one rule to remember.
    if_status_id: Optional[int] = Field(default=None, foreign_key="workflowstatus.id")
    if_priority: Optional[TicketPriority] = None
    if_type: Optional[TicketType] = None
    if_label_id: Optional[int] = Field(default=None, foreign_key="label.id")
    if_project_id: Optional[int] = Field(default=None, foreign_key="project.id")
    if_assignee_id: Optional[int] = Field(default=None, foreign_key="user.id")
    #: "Nobody is assigned", which `if_assignee_id = null` does not say -- that
    #: means "anybody". The two are mutually exclusive; the request model
    #: rejects setting both.
    if_unassigned: bool = Field(default=False)

    # --- Actions ---------------------------------------------------------
    set_status_id: Optional[int] = Field(default=None, foreign_key="workflowstatus.id")
    set_priority: Optional[TicketPriority] = None
    set_type: Optional[TicketType] = None
    set_assignee_id: Optional[int] = Field(default=None, foreign_key="user.id")
    #: Added, never replacing what is there. Labels are additive everywhere
    #: else in SoftTrack, and a rule that silently stripped the ones somebody
    #: chose would be the worst reading of "add a label".
    add_label_id: Optional[int] = Field(default=None, foreign_key="label.id")
    set_sprint_id: Optional[int] = Field(default=None, foreign_key="sprint.id")
    #: "Whichever sprint is running when this fires", as opposed to a named
    #: one. Worth its own flag rather than leaving people to point at a sprint
    #: by id: the useful version of "put new urgent bugs in the sprint" has to
    #: keep meaning that a fortnight later, and a fixed id does not. Mutually
    #: exclusive with `set_sprint_id`.
    move_to_active_sprint: bool = Field(default=False)
    #: Posted with no author -- see Comment.author_id.
    comment_body: Optional[str] = None

    created_by_id: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class AutomationRun(SQLModel, table=True):
    """One time a rule matched a ticket and changed it.

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
    ticket is *not* denormalised: a log entry about a ticket that no longer
    exists is a link to a 404, so those rows go when the ticket does, the same
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
    ticket_id: int = Field(foreign_key="ticket.id", index=True)
    #: Who did the thing that fired the rule. Null for a sprint completing
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
    safe: text arriving from this repository can only ever resolve to tickets
    on the team that connected it, so a webhook nobody on the DES team set up
    cannot move a DES ticket. A repository two teams both work in is connected
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
    #: moving tickets on its team's board. It cannot be hashed -- an HMAC needs
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
    """One branch, commit or pull request that names a ticket.

    Created by the identifier scan, never by hand: the connection between a
    ticket and the code that implements it is already written down in the
    branch name and the commit message, and asking somebody to record it a
    second time is how it stops being recorded at all.

    One table with a `kind` rather than three, for the reason TicketEvent gives:
    the read pattern is "everything linked to this ticket, in one list", which
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
            "repository_id", "kind", "external_id", "ticket_id", name="uq_code_link"
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(foreign_key="ticket.id", index=True)
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


# ---------------------------------------------------------------------------
# Finance (#130-#137). Readable by finance admins only; see lib_finance.
# ---------------------------------------------------------------------------


class Compensation(SQLModel, table=True):
    """One decision about somebody's pay (#131): this much, from this day.

    A salary is not a value but a series of decisions -- hired at X, raised
    to Y in March -- and a column loses the series the first time it is
    updated, and with it the answer to "what was this person paid in Q1",
    which is the question payroll runs and finance reports ask. So pay is
    rows, and the rows are append-only: a raise is a new row, and a
    correction is a new row naming the one it corrects. Nothing here is ever
    updated or deleted.

    What somebody is paid on a given day is the latest row in effect by then
    that no correction replaces -- see `lib_finance/compensation.py`.
    """

    __table_args__ = (
        # Corrected at most once. A second correction corrects the first, so
        # the chain only ever reads one way.
        UniqueConstraint("corrects_id", name="uq_compensation_corrects_id"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    #: Gross agreed pay for one period of `pay_schedule`, in the currency's
    #: minor unit (lib_finance/money.py). An integer, never a float: floating
    #: point and money is a bug that pays somebody a tenth of a cent forever.
    amount_minor: int
    #: An ISO 4217 code. Per record, and never converted into another.
    currency: str
    pay_schedule: PaySchedule
    #: The day it takes effect. A date rather than a timestamp, like a start
    #: date. Still in the future, it is scheduled.
    effective_on: date
    #: Stored by value, so the database says "raise" too.
    kind: CompensationKind = Field(
        sa_column=Column(
            Enum(
                CompensationKind,
                name="compensationkind",
                values_callable=lambda kinds: [kind.value for kind in kinds],
            ),
            nullable=False,
        )
    )
    note: Optional[str] = None
    #: The record this one replaces, when it is a correction.
    corrects_id: Optional[int] = Field(default=None, foreign_key="compensation.id")
    recorded_by_id: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=utcnow)

    # Read-only, and named: two links to `user` make the join ambiguous, and
    # the rows are written through the ids.
    user: Optional[User] = Relationship(
        sa_relationship_kwargs={
            "foreign_keys": "Compensation.user_id",
            "viewonly": True,
        }
    )
    recorded_by: Optional[User] = Relationship(
        sa_relationship_kwargs={
            "foreign_keys": "Compensation.recorded_by_id",
            "viewonly": True,
        }
    )


class PayrollRun(SQLModel, table=True):
    """One pay period on one pay schedule, made concrete (#132).

    A monthly run and a semi-monthly run for September are two runs: a
    period's lines only make sense for the people paid on that schedule. Runs
    on one schedule never overlap, so nobody is paid twice for the same days
    -- the service refuses an overlap, and the constraint catches two runs
    for the same start at once.

    SoftTrack keeps the record and the export. It computes no tax, models no
    withholding, files nothing and pays nobody: the CSV feeds whatever does.
    """

    __table_args__ = (
        UniqueConstraint(
            "pay_schedule", "period_start", name="uq_payrollrun_schedule_start"
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    pay_schedule: PaySchedule
    #: Both days included. Dates, like compensation's effective dates.
    period_start: date
    period_end: date
    state: PayrollRunState = Field(default=PayrollRunState.draft, index=True)
    created_by_id: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=utcnow)
    approved_by_id: Optional[int] = Field(default=None, foreign_key="user.id")
    approved_at: Optional[datetime] = None
    paid_by_id: Optional[int] = Field(default=None, foreign_key="user.id")
    paid_at: Optional[datetime] = None

    # Read-only, and named: three links to `user`.
    created_by: Optional[User] = Relationship(
        sa_relationship_kwargs={
            "foreign_keys": "PayrollRun.created_by_id",
            "viewonly": True,
        }
    )
    approved_by: Optional[User] = Relationship(
        sa_relationship_kwargs={
            "foreign_keys": "PayrollRun.approved_by_id",
            "viewonly": True,
        }
    )
    paid_by: Optional[User] = Relationship(
        sa_relationship_kwargs={
            "foreign_keys": "PayrollRun.paid_by_id",
            "viewonly": True,
        }
    )


class PayrollLine(SQLModel, table=True):
    """One person on one payroll run (#132).

    While the run is a draft, a row exists only to hold an adjustment; the
    rest of a draft line is read live -- who is active, and what they are
    paid on the period's last day -- so a pay recorded or an account opened
    after the run was generated is on it. Approval writes a row for every
    line and copies onto it what it pays: the amount, the currency, the
    record they came from, and the department the person was in. From then on
    the row is the record, whatever later happens to the pay or the person --
    a raise recorded next week cannot change what an approved run says was
    paid, and a reorg in June cannot move January's cost (#134).
    """

    __table_args__ = (
        UniqueConstraint("run_id", "user_id", name="uq_payrollline_run_user"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="payrollrun.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    #: Copied at approval. All three null on a line whose person had no pay
    #: in effect: missing, which the run lists rather than leaving out.
    compensation_id: Optional[int] = Field(default=None, foreign_key="compensation.id")
    amount_minor: Optional[int] = None
    currency: Optional[str] = None
    #: A one-off amount on top, positive or negative, in the line's currency,
    #: and why. Only a draft takes one, and never without its note.
    adjustment_minor: int = Field(default=0)
    adjustment_note: Optional[str] = None
    #: Where the cost belongs, copied at approval (#134). Null for somebody
    #: in no department, who lands in Unattributed rather than nowhere.
    department_id: Optional[int] = Field(default=None, foreign_key="department.id")

    user: Optional[User] = Relationship(
        sa_relationship_kwargs={"foreign_keys": "PayrollLine.user_id", "viewonly": True}
    )
    department: Optional[Department] = Relationship(
        sa_relationship_kwargs={"viewonly": True}
    )


class ReimbursementBatch(SQLModel, table=True):
    """Approved expense claims paid back together (#137).

    The expense counterpart of a payroll run: gathered by a finance admin,
    moved draft -> approved -> paid, and exported as the same kind of CSV.
    Its lines are the claims in it, summed per person per currency; their
    amounts were frozen when each claim was approved, so there is nothing to
    copy here.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    #: The payroll run's states, set the same way and for the same reason.
    state: PayrollRunState = Field(default=PayrollRunState.draft, index=True)
    created_by_id: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=utcnow)
    approved_by_id: Optional[int] = Field(default=None, foreign_key="user.id")
    approved_at: Optional[datetime] = None
    paid_by_id: Optional[int] = Field(default=None, foreign_key="user.id")
    paid_at: Optional[datetime] = None

    created_by: Optional[User] = Relationship(
        sa_relationship_kwargs={
            "foreign_keys": "ReimbursementBatch.created_by_id",
            "viewonly": True,
        }
    )
    approved_by: Optional[User] = Relationship(
        sa_relationship_kwargs={
            "foreign_keys": "ReimbursementBatch.approved_by_id",
            "viewonly": True,
        }
    )
    paid_by: Optional[User] = Relationship(
        sa_relationship_kwargs={
            "foreign_keys": "ReimbursementBatch.paid_by_id",
            "viewonly": True,
        }
    )


class Expense(SQLModel, table=True):
    """One expense claim (#133): money somebody spent for work, wanting it back.

    The submitter can change or withdraw it while it waits. The decision
    freezes it: an approved or refused claim is a record, and a correction is
    a new claim. Approval copies the submitter's department onto it, like a
    payroll line, so a reorg cannot move what a department spent (#134).

    The receipt goes through the attachment pipeline -- the same name
    handling, derived types, byte checks and storage -- but lives on the claim
    rather than as an Attachment row, which always belongs to a ticket and is
    guarded by the ticket's team. A receipt is guarded by who may see money.

    An approved claim is paid back exactly once (#137): in a reimbursement
    batch, or on a payroll run, and never both. That rule is the row's own
    -- two check constraints -- so paying a claim twice cannot be recorded
    at all, rather than being something the service remembers to prevent.
    """

    __table_args__ = (
        CheckConstraint(
            "reimbursement_batch_id IS NULL OR payroll_run_id IS NULL",
            name="ck_expense_settled_once",
        ),
        CheckConstraint(
            "state = 'approved' OR "
            "(reimbursement_batch_id IS NULL AND payroll_run_id IS NULL)",
            name="ck_expense_settles_approved",
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    submitter_id: int = Field(foreign_key="user.id", index=True)
    #: In the currency's minor unit, like compensation, and never converted.
    amount_minor: int
    currency: str
    #: The day the money was spent.
    incurred_on: date
    description: str
    state: ExpenseState = Field(default=ExpenseState.submitted, index=True)
    receipt_filename: Optional[str] = None
    receipt_content_type: Optional[str] = None
    receipt_size_bytes: Optional[int] = None
    receipt_storage_key: Optional[str] = None
    decided_by_id: Optional[int] = Field(default=None, foreign_key="user.id")
    decided_at: Optional[datetime] = None
    #: Required on a refusal, and shown to the submitter.
    refusal_reason: Optional[str] = None
    #: Copied at approval (#134); null for somebody in no department.
    department_id: Optional[int] = Field(default=None, foreign_key="department.id")
    #: How it goes out (#137): one of these, or neither while it waits.
    reimbursement_batch_id: Optional[int] = Field(
        default=None, foreign_key="reimbursementbatch.id", index=True
    )
    payroll_run_id: Optional[int] = Field(
        default=None, foreign_key="payrollrun.id", index=True
    )
    #: When the batch or run it went out in was marked paid: the moment the
    #: submitter's view says "Reimbursed".
    reimbursed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    reimbursement_batch: Optional[ReimbursementBatch] = Relationship(
        sa_relationship_kwargs={"viewonly": True}
    )
    payroll_run: Optional[PayrollRun] = Relationship(
        sa_relationship_kwargs={"viewonly": True}
    )
    submitter: Optional[User] = Relationship(
        sa_relationship_kwargs={
            "foreign_keys": "Expense.submitter_id",
            "viewonly": True,
        }
    )
    decided_by: Optional[User] = Relationship(
        sa_relationship_kwargs={
            "foreign_keys": "Expense.decided_by_id",
            "viewonly": True,
        }
    )
    department: Optional[Department] = Relationship(
        sa_relationship_kwargs={"viewonly": True}
    )


class Budget(SQLModel, table=True):
    """What a department meant to spend in a period, in one currency (#134).

    A period is a start and an end, so months, quarters and a fiscal year
    from April are all just rows. One per department, period and currency: a
    department paying in three currencies has three. The actuals it is
    compared with are never entered -- they are summed from approved payroll
    lines and reimbursed expenses, which is what makes the comparison honest.
    No forecasting, encumbrances or ledger: a budget is a number to compare
    against.
    """

    __table_args__ = (
        UniqueConstraint(
            "department_id",
            "currency",
            "period_start",
            "period_end",
            name="uq_budget_department_currency_period",
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    department_id: int = Field(foreign_key="department.id", index=True)
    period_start: date
    period_end: date
    amount_minor: int
    currency: str
    created_by_id: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    department: Optional[Department] = Relationship(
        sa_relationship_kwargs={"viewonly": True}
    )
    created_by: Optional[User] = Relationship(
        sa_relationship_kwargs={
            "foreign_keys": "Budget.created_by_id",
            "viewonly": True,
        }
    )

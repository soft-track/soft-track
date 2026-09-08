from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from lib_softtrack.tables import IssuePriority, StatusCategory


class ParsedComment(BaseModel):
    body: str
    author: Optional[str] = None
    created_at: Optional[datetime] = None


class ParsedIssue(BaseModel):
    """One issue as read out of an export, before anything is written."""

    external_key: Optional[str] = None
    title: str
    description: Optional[str] = None
    status: StatusCategory
    priority: IssuePriority
    #: Raw values, kept so the report can say what a Jira status was called
    #: before it was mapped.
    raw_status: Optional[str] = None
    raw_priority: Optional[str] = None
    assignee: Optional[str] = None
    reporter: Optional[str] = None
    labels: list[str] = []
    epic: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    comments: list[ParsedComment] = []


class UserMatch(BaseModel):
    """A person named in the export, and who they were matched to."""

    source: str
    matched_user_id: Optional[int] = None
    matched_email: Optional[str] = None
    #: How the match was made: "email", "name", or null when unmatched.
    matched_by: Optional[str] = None


class ImportReport(BaseModel):
    """What an import did, or would do.

    The same shape for a dry run and a real one, so what you approve is
    literally what you then get.
    """

    dry_run: bool
    issues_found: int
    issues_created: int
    #: Issues skipped because their external key is already in this team.
    issues_skipped_existing: int
    comments_created: int
    #: None of the lists below carry a default. The service always sets them,
    #: and defaulting them would make them optional in the schema, pushing an
    #: `undefined` check into every client that reads the report.
    labels_created: list[str]
    projects_created: list[str]
    users: list[UserMatch]
    #: Jira statuses and priorities that had no mapping and fell back.
    unmapped_statuses: list[str]
    unmapped_priorities: list[str]
    #: Anything a person should read before trusting the result.
    warnings: list[str]
    #: The first few issues, so a dry run shows what is actually coming.
    preview: list[ParsedIssue]

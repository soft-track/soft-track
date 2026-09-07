from datetime import datetime

from pydantic import BaseModel

from lib_softtrack.tables import IssuePriority, IssueStatus


class SearchHit(BaseModel):
    id: int
    identifier: str
    title: str
    status: IssueStatus
    priority: IssuePriority
    team_id: int
    updated_at: datetime
    #: Where the match was found: "title", "description" or "comment". Shown
    #: next to the result so a hit with no visible match in the title does not
    #: look like a mistake.
    matched_in: str
    #: A short window of the matching text, or the start of the description
    #: when the match was in the title.
    snippet: str

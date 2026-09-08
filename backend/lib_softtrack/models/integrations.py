from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from lib_identity.models.identity import UserPublic
from lib_softtrack.tables import CodeLinkKind, GitProvider, PullRequestState


class RepositoryCreate(BaseModel):
    provider: GitProvider
    #: "owner/name", as the provider writes it. Taken from the person rather
    #: than discovered, because SoftTrack never calls the provider's API --
    #: there is nothing to discover it with, and nothing to discover it from
    #: until the first webhook arrives.
    full_name: str = Field(min_length=3, max_length=200)

    @field_validator("full_name")
    @classmethod
    def _looks_like_a_repository(cls, value: str) -> str:
        name = value.strip().strip("/")
        # A URL is what people paste, and accepting one silently would mean
        # comparing "https://github.com/acme/api" against the "acme/api" every
        # payload carries and never matching. Better to say so.
        if "://" in name:
            raise ValueError("Give the repository as owner/name, not as a URL.")
        if name.count("/") < 1 or name.startswith("/") or name.endswith("/"):
            raise ValueError("A repository looks like owner/name, e.g. acme/api.")
        return name


class RepositoryRead(BaseModel):
    """A connected repository, as the settings page receives it.

    Carries the secret. There is no point hiding it: the person reading this
    page is a team admin, it has to be pasted into the provider's settings
    form, and a "shown once" secret only means the rotate button gets used as
    a "show it again" button. What it does mean is that this response is
    admin-only -- see the router.
    """

    id: int
    team_id: int
    provider: GitProvider
    full_name: str
    #: Where the provider should send deliveries, built from the API's own
    #: base URL -- see `Settings.api_base_url`. Assembled here rather than in
    #: the browser because the URL GitHub has to reach is a property of the
    #: deployment, and the browser only knows the one *it* reaches.
    webhook_url: str
    secret: str
    #: Null until the first verified delivery. The one thing that tells "set
    #: up correctly" apart from "set up and never fired".
    last_delivery_at: Optional[datetime]
    created_by: UserPublic
    created_at: datetime


class RepositoryLinkedItem(BaseModel):
    """Which repository a link came from, for an issue that has several."""

    id: int
    provider: GitProvider
    full_name: str


class CodeLinkRead(BaseModel):
    id: int
    kind: CodeLinkKind
    #: The branch name, the commit sha, or the pull request number as text.
    external_id: str
    title: Optional[str]
    url: str
    #: Pull requests only.
    state: Optional[PullRequestState]
    #: The provider's name for whoever did it, not a SoftTrack user -- see
    #: `CodeLink.author_name`.
    author_name: Optional[str]
    repository: RepositoryLinkedItem
    created_at: datetime
    updated_at: datetime


class CodeLinks(BaseModel):
    """Everything connected to one issue, in the three groups it reads as.

    Grouped in the response rather than sorted in the browser, the same way
    IssueLinks is: the three have different shapes on the page -- a pull
    request has a state, a commit has a sha -- so a flat list would be
    regrouped by every client that rendered it.
    """

    branches: list[CodeLinkRead] = []
    commits: list[CodeLinkRead] = []
    pull_requests: list[CodeLinkRead] = []


class WebhookReceipt(BaseModel):
    """What the webhook endpoint answers with.

    More than an empty 200 on purpose. Both providers show the response body
    in their delivery log, and that log is the entire debugging surface for
    whoever is setting this up -- "accepted, matched nothing" is the answer to
    the question they are about to ask, and it is much cheaper to read there
    than to work out from an issue page that did not change.
    """

    #: Events in the delivery that this integration understands. Zero is
    #: normal -- a tag push, a label added to a pull request.
    events: int
    #: Links created or updated as a result.
    links: int
    #: The issues the delivery named, e.g. `["ENG-42"]`. Empty means nothing
    #: in the text resolved to an issue on this team.
    issues: list[str] = []

import enum
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field

from lib_identity.models.identity import PersonRef, UserMe


class AdminRole(str, enum.Enum):
    """The instance-wide roles the user directory filters by (#130), and
    accounts from outside the organisation (#243)."""

    site_admin = "site_admin"
    finance_admin = "finance_admin"
    external = "external"


class GuestOf(BaseModel):
    """A team an account from outside is a guest of, and the epics it sees
    there (#243): its reach, as the directory shows it."""

    team_id: int
    team_name: str
    team_key: str
    epics: list[str]


class AdminUserRead(UserMe):
    """A row in the site admin's user directory."""

    last_login_at: Optional[datetime] = None
    #: How many teams the account belongs to. Enough to tell an active
    #: colleague from a stale invite-era account without opening every team.
    team_count: int
    #: How many active accounts report to them (#124).
    report_count: int
    #: When the finance access they hold was granted, and who granted it
    #: (#130). Null when they have none. The access, never any money: that
    #: lives in the finance schemas, which nothing here reuses.
    finance_admin_since: Optional[datetime] = None
    finance_admin_granted_by: Optional[PersonRef] = None
    #: For an account from outside (#243): where it is a guest and what it
    #: sees there. Empty for everybody else.
    guest_of: list[GuestOf] = []


class AdminUserUpdate(BaseModel):
    is_active: Optional[bool] = None
    is_site_admin: Optional[bool] = None
    #: Grant or revoke finance access (#130). Logged either way. A site admin
    #: may grant it to themselves: nothing is guarded by refusing, since they
    #: could grant it to anybody.
    is_finance_admin: Optional[bool] = None
    #: From outside the organisation (#243). Set here or on the invitation,
    #: never by the person. Refused for an admin of any kind, and while the
    #: account is more than a guest on a team.
    is_external: Optional[bool] = None
    full_name: Optional[str] = None
    #: When they started (#122). An explicit null clears it; leaving it out
    #: leaves it alone. Set here and nowhere else: it is the organisation's
    #: fact, so the person cannot change it from their own profile.
    started_on: Optional[date] = None
    #: Which department they are in (#123); an explicit null takes them out
    #: of it. Like the start date, the organisation's to say.
    department_id: Optional[int] = None
    #: Who they report to (#124); an explicit null clears it. Refused when it
    #: would make a loop, or name a deactivated account as a new manager.
    manager_id: Optional[int] = None


class AdminPasswordReset(BaseModel):
    new_password: str = Field(min_length=8)

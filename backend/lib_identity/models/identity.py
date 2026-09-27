from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str
    #: Blank means "derive one from the address"; see lib_identity/usernames.py.
    username: Optional[str] = None
    #: Present when the person arrived through an invitation link, so the
    #: account lands in the team instead of nowhere.
    invite_token: Optional[str] = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserPublic(BaseModel):
    id: int
    email: str
    username: str
    full_name: str
    avatar_color: str
    #: Shown as a "Deactivated" badge on rosters, and used to keep deactivated
    #: people out of assignee pickers without hiding work already assigned.
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


class UserMe(UserPublic):
    """The signed-in user's own record.

    A superset of UserPublic rather than a separate model: what the account
    can do instance-wide is the user's business, and nobody else's, so it is
    only ever returned for `me`.
    """

    is_site_admin: bool
    #: False for an account created by signing in with Google or GitHub and
    #: never given one. What the Security page reads to offer "Set a password"
    #: instead of "Change password", and what stops the app asking for a
    #: password that does not exist.
    has_password: bool
    created_at: datetime
    #: What the organisation knows about them (#122). Null until somebody
    #: fills it in. Title and location are theirs to edit; the start date is
    #: set by a site admin.
    job_title: Optional[str] = None
    location: Optional[str] = None
    started_on: Optional[date] = None


#: Long enough for "Senior Staff Site Reliability Engineer, Payments" and a
#: city with its country; short enough to fit a directory row.
PROFILE_TEXT_MAX = 100


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    username: Optional[str] = None
    avatar_color: Optional[str] = None
    email: Optional[EmailStr] = None
    #: Blank or null clears it. Only the person edits these two; there is no
    #: admin route to them, because a title and a location are theirs to say.
    job_title: Optional[str] = Field(default=None, max_length=PROFILE_TEXT_MAX)
    location: Optional[str] = Field(default=None, max_length=PROFILE_TEXT_MAX)
    #: Required only when `email` changes, and only for an account that has a
    #: password. An address is the identity a password reset would one day be
    #: sent to, so changing it is re-verified even though the session is
    #: already authenticated.
    current_password: Optional[str] = None


class PasswordChange(BaseModel):
    #: Optional only for an account that has no password yet -- one created by
    #: signing in with a provider. Anywhere else an absent value simply fails
    #: the check, the same way a wrong one does.
    current_password: Optional[str] = None
    new_password: str = Field(min_length=8)


class ForgotPassword(BaseModel):
    email: EmailStr


class ResetPassword(BaseModel):
    """The token from a reset link, and the password to set with it."""

    token: str = Field(min_length=1)
    new_password: str = Field(min_length=8)


class AuthConfig(BaseModel):
    """What the sign-in pages need to know before anyone has authenticated."""

    open_registration: bool
    #: Whether / shows the landing page to a signed-out visitor, or redirects
    #: to the sign-in form the way it did before there was one.
    landing_page: bool
    #: Whether this instance is seeded with the published demo account, and so
    #: may prefill its address and print its password under the sign-in button.
    demo_credentials: bool
    #: The providers this instance can sign somebody in with, in the order the
    #: buttons should appear. Empty on an install that has configured neither,
    #: which is the default and keeps SoftTrack dependency-free.
    oauth_providers: list[str]
    #: Whether "Forgot password?" is offered (#83). Only when this instance
    #: can send mail -- a link to a form whose email never arrives is worse
    #: than no link.
    password_reset: bool


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserMe

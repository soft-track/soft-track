"""Machine-readable error codes on API errors (#86).

An error the API raises on purpose carries two things: `detail`, the English
sentence it always had, and `code`, a stable identifier a client can branch on
or translate. The body is

    {"detail": "Only team admins can do that", "code": "not_team_admin"}

`detail` is unchanged from before codes existed, so nothing that shows it
regresses. `code` is what a client should switch on: the sentence can be
reworded, the code cannot -- removing or renaming one is a breaking change.

Validation errors (422 from FastAPI's own request checking) keep their
existing shape and have no code; they already carry machine-readable `loc`
and `type` fields.

`ErrorCode` below is the one place the codes are listed. It is published in
the OpenAPI schema as `ErrorCode`, so the generated frontend client has the
same list as a type.
"""

import enum
from typing import Mapping, Optional

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel


class ErrorCode(str, enum.Enum):
    """Every code the API can return. Grouped by what the client did wrong."""

    # --- who you are -----------------------------------------------------------
    #: No token, a malformed or expired one, or one for a signed-out session.
    not_authenticated = "not_authenticated"
    #: Wrong email or password. Deliberately one code for both.
    bad_credentials = "bad_credentials"
    #: The account exists and has been switched off by a site admin.
    account_deactivated = "account_deactivated"
    #: Too many attempts; `Retry-After` says when to try again.
    rate_limited = "rate_limited"

    # --- what you may do -------------------------------------------------------
    not_team_member = "not_team_member"
    not_team_admin = "not_team_admin"
    #: A guest of the team (#104): may look, may not change anything.
    team_read_only = "team_read_only"
    not_site_admin = "not_site_admin"
    #: Money is for finance admins only (#130), whatever else the account may
    #: do -- a site admin included.
    not_finance_admin = "not_finance_admin"
    #: Registration is invite-only on this instance.
    invite_only = "invite_only"

    # --- something you named does not exist ------------------------------------
    team_not_found = "team_not_found"
    ticket_not_found = "ticket_not_found"
    #: Some of a bulk edit's tickets are missing or on another team.
    tickets_not_found = "tickets_not_found"
    parent_not_found = "parent_not_found"
    project_not_found = "project_not_found"
    sprint_not_found = "sprint_not_found"
    status_not_found = "status_not_found"
    view_not_found = "view_not_found"
    rule_not_found = "rule_not_found"
    link_not_found = "link_not_found"
    attachment_not_found = "attachment_not_found"
    comment_not_found = "comment_not_found"
    template_not_found = "template_not_found"
    worklog_not_found = "worklog_not_found"
    notification_not_found = "notification_not_found"
    repository_not_found = "repository_not_found"
    invite_not_found = "invite_not_found"
    user_not_found = "user_not_found"
    department_not_found = "department_not_found"
    #: A compensation record that does not exist, or is somebody else's (#131).
    compensation_not_found = "compensation_not_found"
    payroll_run_not_found = "payroll_run_not_found"
    #: Adjusting somebody who is not on the run (#132).
    payroll_line_not_found = "payroll_line_not_found"
    #: A claim that does not exist, or -- to its submitter's API -- is
    #: somebody else's (#133).
    expense_not_found = "expense_not_found"
    receipt_not_found = "receipt_not_found"
    reimbursement_batch_not_found = "reimbursement_batch_not_found"
    budget_not_found = "budget_not_found"
    #: The person is not a member of the team the request is about.
    member_not_found = "member_not_found"
    #: A status, label, project or sprint id that belongs to another team.
    not_on_this_team = "not_on_this_team"
    #: An assignee, lead or filter naming someone outside the team.
    user_not_on_team = "user_not_on_team"

    # --- it clashes with something that exists --------------------------------
    email_taken = "email_taken"
    username_taken = "username_taken"
    team_key_taken = "team_key_taken"
    status_name_taken = "status_name_taken"
    template_name_taken = "template_name_taken"
    rule_name_taken = "rule_name_taken"
    #: Department names are unique whatever the case (#123).
    department_name_taken = "department_name_taken"
    already_member = "already_member"
    link_exists = "link_exists"
    link_contradicts = "link_contradicts"
    repository_already_connected = "repository_already_connected"
    oauth_account_taken = "oauth_account_taken"

    # --- a rule of the model says no ------------------------------------------
    #: The last admin of a team cannot leave, be removed or be demoted.
    last_team_admin = "last_team_admin"
    last_site_admin = "last_site_admin"
    #: A team must keep at least one status.
    last_status = "last_status"
    team_has_no_statuses = "team_has_no_statuses"
    cannot_deactivate_self = "cannot_deactivate_self"
    cannot_demote_self = "cannot_demote_self"
    #: A completed sprint's numbers are history and cannot change.
    sprint_completed = "sprint_completed"
    sprint_already_active = "sprint_already_active"
    sprint_dates_invalid = "sprint_dates_invalid"
    link_to_self = "link_to_self"
    parent_is_self = "parent_is_self"
    parent_other_team = "parent_other_team"
    #: Sub-tickets are one level deep.
    parent_is_subticket = "parent_is_subticket"
    ticket_has_subtickets = "ticket_has_subtickets"
    labels_conflict = "labels_conflict"
    status_order_incomplete = "status_order_incomplete"
    template_order_incomplete = "template_order_incomplete"
    status_move_to_same = "status_move_to_same"
    #: Only the person who logged time can change or delete the entry (#102).
    not_your_worklog = "not_your_worklog"
    #: Only a comment's author can edit it; its author or a team admin can
    #: delete it (#93).
    not_your_comment = "not_your_comment"
    #: A date worked that has not happened yet.
    worklog_in_future = "worklog_in_future"
    #: Moving a ticket to the team it is already on (#98).
    transfer_same_team = "transfer_same_team"
    view_other_team = "view_other_team"
    view_private_default = "view_private_default"
    #: A card cannot be dropped next to itself (#88).
    rank_neighbour_is_self = "rank_neighbour_is_self"
    password_required_to_disconnect = "password_required_to_disconnect"
    #: Deleting a department with people in it needs to be told where they
    #: go: another department, or none (#123).
    department_not_empty = "department_not_empty"
    department_move_to_same = "department_move_to_same"
    #: A manager link that would loop: somebody managing themselves, or
    #: reporting to a person who already reports to them (#124).
    manager_is_self = "manager_is_self"
    manager_cycle = "manager_cycle"
    #: A deactivated account cannot take on new reports.
    manager_deactivated = "manager_deactivated"
    #: A compensation record is corrected once; a second correction corrects
    #: the first (#131).
    compensation_already_corrected = "compensation_already_corrected"
    #: Payroll runs on one schedule never cover the same day twice (#132).
    payroll_run_overlaps = "payroll_run_overlaps"
    #: Only a draft run changes; approval freezes it.
    payroll_run_not_draft = "payroll_run_not_draft"
    #: Paid, or exported, only once approved.
    payroll_run_not_approved = "payroll_run_not_approved"
    #: A line with no pay recorded has no currency to adjust in.
    payroll_line_missing_pay = "payroll_line_missing_pay"
    #: An adjustment that would take a line below zero.
    payroll_adjustment_too_large = "payroll_adjustment_too_large"
    #: A decided claim is a record; a correction is a new claim (#133).
    expense_decided = "expense_decided"
    #: Nobody decides their own claim.
    expense_own_claim = "expense_own_claim"
    #: A claim is for money already spent.
    expense_in_future = "expense_in_future"
    #: Only an approved claim is paid back (#137).
    expense_not_approved = "expense_not_approved"
    #: A claim is paid back exactly once: it is already in a batch or on a run.
    expense_already_settled = "expense_already_settled"
    #: A claim whose batch or run has been approved stays in it.
    expense_settlement_locked = "expense_settlement_locked"
    #: A payroll run carries reimbursements only for the people it pays.
    reimbursement_not_on_run = "reimbursement_not_on_run"
    reimbursement_batch_not_draft = "reimbursement_batch_not_draft"
    reimbursement_batch_not_approved = "reimbursement_batch_not_approved"
    #: One budget per department, period and currency (#134).
    budget_exists = "budget_exists"
    #: A budget's period ends before it starts.
    budget_period_invalid = "budget_period_invalid"
    #: A department that approved payroll (and, later, expenses and budgets)
    #: is attributed to is renamed, not deleted: the record keeps pointing at it.
    department_has_finance_history = "department_has_finance_history"

    # --- what you sent is not usable ------------------------------------------
    name_required = "name_required"
    #: A template (#97) whose text is only whitespace.
    body_required = "body_required"
    invalid_colour = "invalid_colour"
    username_invalid = "username_invalid"
    current_password_incorrect = "current_password_incorrect"
    current_password_required = "current_password_required"
    file_empty = "file_empty"
    file_too_large = "file_too_large"
    attachment_name_missing = "attachment_name_missing"
    attachment_type_not_allowed = "attachment_type_not_allowed"
    #: The file's bytes are not the type its name and header claim.
    attachment_content_mismatch = "attachment_content_mismatch"
    attachment_not_attachable = "attachment_not_attachable"
    #: The attachment's row exists but its bytes are gone from storage.
    attachment_gone = "attachment_gone"
    #: A byte range that starts past the end of the file.
    range_not_satisfiable = "range_not_satisfiable"
    import_not_utf8 = "import_not_utf8"
    import_invalid = "import_invalid"
    import_empty = "import_empty"

    # --- links and sign-in flows -----------------------------------------------
    invite_invalid = "invite_invalid"
    api_token_not_found = "api_token_not_found"
    webhook_not_found = "webhook_not_found"
    #: Not an http(s) URL, or no events chosen.
    webhook_invalid = "webhook_invalid"
    #: The URL points at a private, loopback or link-local address (#91).
    webhook_target_private = "webhook_target_private"
    #: Tokens, passwords and other credentials are managed from a signed-in
    #: session, not with an API token -- see lib_identity/api_tokens.py.
    api_token_not_allowed = "api_token_not_allowed"
    invite_wrong_recipient = "invite_wrong_recipient"
    #: A password reset link that is wrong, used, expired or superseded.
    reset_link_invalid = "reset_link_invalid"
    #: This instance has no SMTP server configured.
    email_not_configured = "email_not_configured"
    oauth_provider_unknown = "oauth_provider_unknown"
    oauth_provider_disabled = "oauth_provider_disabled"
    oauth_expired = "oauth_expired"
    oauth_connect_failed = "oauth_connect_failed"
    oauth_not_connected = "oauth_not_connected"


class ApiErrorBody(BaseModel):
    """The body of every error raised with a code."""

    detail: str
    code: ErrorCode


class ApiError(HTTPException):
    """An HTTPException that also carries an ErrorCode.

    A subclass, so every `except HTTPException` already in the codebase keeps
    catching it and reading `status_code` and `detail` as before.
    """

    def __init__(
        self,
        status_code: int,
        code: ErrorCode,
        detail: str,
        headers: Optional[Mapping[str, str]] = None,
    ):
        super().__init__(status_code=status_code, detail=detail, headers=headers)
        self.code = code


def api_error(
    status_code: int,
    code: ErrorCode,
    detail: str,
    headers: Optional[Mapping[str, str]] = None,
) -> ApiError:
    """Build an error to `raise`: `raise api_error(403, ErrorCode.x, "…")`."""
    return ApiError(status_code=status_code, code=code, detail=detail, headers=headers)


async def api_error_handler(_request: Request, exc: ApiError) -> JSONResponse:
    """Serialise an ApiError: FastAPI's own body, plus the code."""
    return JSONResponse(
        status_code=exc.status_code,
        content=ApiErrorBody(detail=exc.detail, code=exc.code).model_dump(mode="json"),
        headers=dict(exc.headers) if exc.headers else None,
    )

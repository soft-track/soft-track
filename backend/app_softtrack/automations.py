from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from lib_identity.identity import get_current_user
from lib_softtrack import automations as automations_service
from lib_softtrack.models.automations import (
    AutomationRuleCreate,
    AutomationRuleRead,
    AutomationRuleUpdate,
    AutomationRunRead,
)
from lib_softtrack.models.page import DEFAULT_LIMIT, MAX_LIMIT, Page
from lib_softtrack.tables import User
from web import get_session

router = APIRouter(tags=["automations"])


@router.get(
    "/teams/{team_id}/automation-rules", response_model=list[AutomationRuleRead]
)
def list_rules(
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Every rule on the team, enabled or not, in the order they run.

    Readable by any member even though only admins may write one: a rule acts
    on your issues, so being unable to find out what the rules are is not a
    reasonable place to be.
    """
    return automations_service.list_rules(session, current_user, team_id)


@router.post("/teams/{team_id}/automation-rules", response_model=AutomationRuleRead)
def create_rule(
    team_id: int,
    payload: AutomationRuleCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Add a rule. Team admins only, like statuses and unlike labels."""
    return automations_service.create_rule(session, current_user, team_id, payload)


# The run log sits above /automation-rules/{rule_id} in the file but under its
# own path, so "runs" is never read as a rule id.
@router.get("/teams/{team_id}/automation-runs", response_model=Page[AutomationRunRead])
def list_runs(
    team_id: int,
    rule_id: Optional[int] = Query(None),
    issue_id: Optional[int] = Query(None),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """What the team's rules have actually done, newest first.

    Filterable by rule and by issue, which are the two forms the question
    takes: "what has this rule been doing" and "why did this issue move".
    """
    return automations_service.list_runs(
        session,
        current_user,
        team_id,
        rule_id=rule_id,
        issue_id=issue_id,
        limit=limit,
        offset=offset,
    )


# Per-rule routes hang off /automation-rules rather than nesting under the
# team, the way views do: a rule id is unique without its team.
@router.patch("/automation-rules/{rule_id}", response_model=AutomationRuleRead)
def update_rule(
    rule_id: int,
    payload: AutomationRuleUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return automations_service.update_rule(session, current_user, rule_id, payload)


@router.delete("/automation-rules/{rule_id}", status_code=204)
def delete_rule(
    rule_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Remove a rule. Its run log stays -- see automations.delete_rule."""
    automations_service.delete_rule(session, current_user, rule_id)

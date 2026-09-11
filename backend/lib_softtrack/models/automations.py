from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from lib_identity.models.identity import UserPublic
from lib_softtrack.tables import AutomationTrigger, IssuePriority


class RuleConditions(BaseModel):
    """Which issues a rule acts on, out of the ones its trigger reaches.

    Nested rather than flattened into the rule models so that "what a rule
    matches" is one shape wherever it appears -- the same reason ViewFilters
    is nested, and near enough the same vocabulary. Null everywhere means
    "every issue this trigger sees", which is what an unconditioned rule
    should do rather than one that matches nothing.
    """

    #: For a `status_changed` trigger this is the status the issue moved *to*.
    if_status_id: Optional[int] = None
    if_priority: Optional[IssuePriority] = None
    if_label_id: Optional[int] = None
    if_project_id: Optional[int] = None
    if_assignee_id: Optional[int] = None
    #: "Nobody is assigned", which `if_assignee_id = null` does not say.
    if_unassigned: bool = False

    @model_validator(mode="after")
    def _one_assignee_question_at_a_time(self) -> "RuleConditions":
        if self.if_unassigned and self.if_assignee_id is not None:
            raise ValueError(
                "A rule matches on an assignee or on being unassigned, not both."
            )
        return self


class RuleActions(BaseModel):
    """What a rule does to an issue it matched.

    Every field is optional and this model asserts nothing about the
    combination, because it is also the shape a *stored* rule is read back in
    -- and a stored rule can be left with no actions at all. Deleting a cycle
    strips `set_cycle_id` out of the rules that filled it and switches them
    off, and a rule in that state has to survive being listed so that somebody
    can see it and decide what it should say instead.

    The two things a rule being *written* may not do -- nothing at all, and
    naming both a cycle and the active one -- are checked on
    AutomationRuleCreate and AutomationRuleUpdate, which is where writing
    happens.
    """

    set_status_id: Optional[int] = None
    set_priority: Optional[IssuePriority] = None
    set_assignee_id: Optional[int] = None
    #: Added to whatever the issue already has, never replacing it.
    add_label_id: Optional[int] = None
    set_cycle_id: Optional[int] = None
    #: "Whichever cycle is running when this fires." Keeps meaning the same
    #: thing a fortnight later, which a fixed cycle id does not.
    move_to_active_cycle: bool = False
    comment_body: Optional[str] = Field(default=None, max_length=2000)

    @property
    def is_empty(self) -> bool:
        return not any(
            (
                self.set_status_id is not None,
                self.set_priority is not None,
                self.set_assignee_id is not None,
                self.add_label_id is not None,
                self.set_cycle_id is not None,
                self.move_to_active_cycle,
                (self.comment_body or "").strip(),
            )
        )


def _check_writable(actions: RuleActions) -> None:
    """What a rule somebody is writing may not say.

    Separate from RuleActions itself so that reading a rule back is never
    subject to it -- see that class. Called from both write models rather than
    inherited, because they share no base and one of them makes `actions`
    optional.
    """
    if actions.is_empty:
        raise ValueError("A rule has to do something; give it at least one action.")
    if actions.move_to_active_cycle and actions.set_cycle_id is not None:
        raise ValueError(
            "A rule moves an issue to a named cycle or to the active one, not both."
        )


class AutomationRuleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    trigger: AutomationTrigger
    is_enabled: bool = True
    conditions: RuleConditions = RuleConditions()
    actions: RuleActions

    @model_validator(mode="after")
    def _actions_are_writable(self) -> "AutomationRuleCreate":
        _check_writable(self.actions)
        return self


class AutomationRuleUpdate(BaseModel):
    """Every field optional: renaming a rule, rewriting it and switching it
    off are separate gestures and each sends only what it changed.

    The trigger can be changed. It reads like a different rule afterwards, but
    refusing would only mean people deleting and recreating -- and losing the
    run log's link to the rule in the process.
    """

    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    trigger: Optional[AutomationTrigger] = None
    is_enabled: Optional[bool] = None
    conditions: Optional[RuleConditions] = None
    actions: Optional[RuleActions] = None

    @model_validator(mode="after")
    def _actions_are_writable(self) -> "AutomationRuleUpdate":
        if self.actions is not None:
            _check_writable(self.actions)
        return self


class AutomationRuleRead(BaseModel):
    id: int
    team_id: int
    name: str
    trigger: AutomationTrigger
    is_enabled: bool
    conditions: RuleConditions
    actions: RuleActions
    created_by: UserPublic
    created_at: datetime
    updated_at: datetime


class AutomationRunRead(BaseModel):
    """One line of the run log.

    Carries the rule's name rather than only its id, and `rule_id` is null
    once the rule is gone -- the log outlives it on purpose. See
    AutomationRun.
    """

    id: int
    rule_id: Optional[int]
    rule_name: str
    trigger: AutomationTrigger
    issue_id: int
    #: e.g. "ENG-42". Denormalised into the response, not the row: it is the
    #: team key and the issue number, both of which are still there to read.
    issue_identifier: str
    issue_title: str
    #: Who did the thing that set the rule off. Null when nobody did -- a
    #: cycle completing, or an event an earlier rule caused.
    actor: Optional[UserPublic]
    #: What it did, one action per line.
    summary: str
    created_at: datetime

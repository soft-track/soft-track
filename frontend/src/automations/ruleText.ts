import type {
  AutomationRuleRead,
  AutomationTrigger,
  CycleRead,
  IssuePriority,
  LabelRead,
  ProjectRead,
  RuleActions,
  RuleConditions,
  StatusRead,
  TeamMemberRead,
} from '@/api/generated/models'
import { i18n } from '@/i18n'
import { formatList } from '@/i18n/format'

/**
 * Turning a stored rule back into the sentence somebody meant by it.
 *
 * A rule is a row of ids, and a row of ids is unreadable. Every list of rules
 * anybody has ever had to audit was audited by reading it out loud, so the
 * settings page renders exactly that -- "When an issue is created, if it is
 * urgent, set status to Todo" -- from the same pieces the editor collects.
 *
 * Pure and in its own module so it can be tested without a DOM, and so the
 * list row and the run log cannot describe the same rule differently.
 *
 * The words are in the `automations` catalog (#106). What this module hands
 * out are clauses, not sentences -- "it is in Todo", "assign it to Maya" --
 * each one a whole catalog phrase with the name inside it, and the settings
 * page slots them into its sentence templates (`settings:automation.sentence`),
 * so word order around them belongs to the sentence, not to this file.
 */

// Getters over the catalog, so every caller keeps reading
// `TRIGGER_LABELS[trigger]` and gets the current language's words.
export const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  get issue_created() {
    return i18n.t('automations:trigger.issue_created')
  },
  get status_changed() {
    return i18n.t('automations:trigger.status_changed')
  },
  get issue_assigned() {
    return i18n.t('automations:trigger.issue_assigned')
  },
  get comment_added() {
    return i18n.t('automations:trigger.comment_added')
  },
  get cycle_completed() {
    return i18n.t('automations:trigger.cycle_completed')
  },
  get branch_created() {
    return i18n.t('automations:trigger.branch_created')
  },
  get pull_request_opened() {
    return i18n.t('automations:trigger.pull_request_opened')
  },
  get pull_request_merged() {
    return i18n.t('automations:trigger.pull_request_merged')
  },
}

/** Everything the sentences need to turn an id into a name. */
export type RuleVocabulary = {
  statuses: StatusRead[]
  labels: LabelRead[]
  projects: ProjectRead[]
  members: TeamMemberRead[]
  cycles: CycleRead[]
}

function statusName(vocabulary: RuleVocabulary, id: number): string {
  return (
    vocabulary.statuses.find((s) => s.id === id)?.name ??
    i18n.t('automations:missing.status')
  )
}

function labelName(vocabulary: RuleVocabulary, id: number): string {
  return (
    vocabulary.labels.find((l) => l.id === id)?.name ??
    i18n.t('automations:missing.label')
  )
}

function projectName(vocabulary: RuleVocabulary, id: number): string {
  return (
    vocabulary.projects.find((p) => p.id === id)?.name ??
    i18n.t('automations:missing.project')
  )
}

function personName(vocabulary: RuleVocabulary, id: number): string {
  return (
    vocabulary.members.find((m) => m.user.id === id)?.user.full_name ??
    i18n.t('automations:missing.person')
  )
}

function cycleName(vocabulary: RuleVocabulary, id: number): string {
  return (
    vocabulary.cycles.find((c) => c.id === id)?.display_name ??
    i18n.t('automations:missing.cycle')
  )
}

// Mid-clause: "its priority is urgent" -- the catalog's clause words.
function priorityName(priority: IssuePriority): string {
  return i18n.t(`automations:priorityInClause.${priority}`)
}

/**
 * The conditions, one clause each. Empty means the rule fires on everything
 * its trigger reaches, which the caller renders as "any issue" rather than as
 * nothing at all — a blank line there reads as a rule that is broken.
 */
export function describeConditions(
  conditions: RuleConditions,
  vocabulary: RuleVocabulary,
): string[] {
  const clauses: string[] = []
  if (conditions.if_status_id != null) {
    clauses.push(
      i18n.t('automations:condition.inStatus', {
        status: statusName(vocabulary, conditions.if_status_id),
      }),
    )
  }
  if (conditions.if_priority != null) {
    clauses.push(
      i18n.t('automations:condition.priority', {
        priority: priorityName(conditions.if_priority),
      }),
    )
  }
  if (conditions.if_label_id != null) {
    clauses.push(
      i18n.t('automations:condition.hasLabel', {
        label: labelName(vocabulary, conditions.if_label_id),
      }),
    )
  }
  if (conditions.if_project_id != null) {
    clauses.push(
      i18n.t('automations:condition.inProject', {
        project: projectName(vocabulary, conditions.if_project_id),
      }),
    )
  }
  if (conditions.if_unassigned) {
    clauses.push(i18n.t('automations:condition.unassigned'))
  } else if (conditions.if_assignee_id != null) {
    clauses.push(
      i18n.t('automations:condition.assignedTo', {
        name: personName(vocabulary, conditions.if_assignee_id),
      }),
    )
  }
  return clauses
}

/** The actions, one clause each, in the order the backend applies them. */
export function describeActions(
  actions: RuleActions,
  vocabulary: RuleVocabulary,
): string[] {
  const clauses: string[] = []
  if (actions.set_status_id != null) {
    clauses.push(
      i18n.t('automations:action.setStatus', {
        status: statusName(vocabulary, actions.set_status_id),
      }),
    )
  }
  if (actions.set_priority != null) {
    clauses.push(
      i18n.t('automations:action.setPriority', { priority: priorityName(actions.set_priority) }),
    )
  }
  if (actions.set_assignee_id != null) {
    clauses.push(
      i18n.t('automations:action.assignTo', {
        name: personName(vocabulary, actions.set_assignee_id),
      }),
    )
  }
  if (actions.add_label_id != null) {
    clauses.push(
      i18n.t('automations:action.addLabel', {
        label: labelName(vocabulary, actions.add_label_id),
      }),
    )
  }
  if (actions.move_to_active_cycle) {
    clauses.push(i18n.t('automations:action.moveToActiveCycle'))
  } else if (actions.set_cycle_id != null) {
    clauses.push(
      i18n.t('automations:action.moveToCycle', {
        cycle: cycleName(vocabulary, actions.set_cycle_id),
      }),
    )
  }
  if (actions.comment_body?.trim()) {
    clauses.push(i18n.t('automations:action.postComment'))
  }
  return clauses
}

/** `["it is urgent", "it has the label bug"]` → `"it is urgent and it has the label bug"`. */
export function joinClauses(clauses: string[]): string {
  return formatList(clauses)
}

/** The whole rule as one sentence, for a list row and for a screen reader. */
export function describeRule(
  rule: AutomationRuleRead,
  vocabulary: RuleVocabulary,
): string {
  const conditions = describeConditions(rule.conditions, vocabulary)
  const actions = describeActions(rule.actions, vocabulary)
  const values = {
    trigger: TRIGGER_LABELS[rule.trigger],
    conditions: joinClauses(conditions),
    actions: joinClauses(actions),
  }
  const hasConditions = conditions.length > 0
  // A rule can be left with no actions when the cycle it filled is deleted;
  // it is switched off at the same time. Saying so beats an empty sentence.
  if (actions.length === 0) {
    return hasConditions
      ? i18n.t('automations:rule.ifEmpty', values)
      : i18n.t('automations:rule.empty', values)
  }
  return hasConditions
    ? i18n.t('automations:rule.ifThen', values)
    : i18n.t('automations:rule.then', values)
}

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
import { PRIORITY_META } from '@/issues/issueMeta'

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
 */

export const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  issue_created: 'an issue is created',
  status_changed: 'an issue changes status',
  issue_assigned: 'an issue is assigned',
  comment_added: 'a comment is added',
  cycle_completed: 'a cycle is completed',
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
  return vocabulary.statuses.find((s) => s.id === id)?.name ?? 'a deleted status'
}

function labelName(vocabulary: RuleVocabulary, id: number): string {
  return vocabulary.labels.find((l) => l.id === id)?.name ?? 'a deleted label'
}

function projectName(vocabulary: RuleVocabulary, id: number): string {
  return vocabulary.projects.find((p) => p.id === id)?.name ?? 'a deleted project'
}

function personName(vocabulary: RuleVocabulary, id: number): string {
  return (
    vocabulary.members.find((m) => m.user.id === id)?.user.full_name ??
    'someone who has left'
  )
}

function cycleName(vocabulary: RuleVocabulary, id: number): string {
  return vocabulary.cycles.find((c) => c.id === id)?.display_name ?? 'a deleted cycle'
}

function priorityName(priority: IssuePriority): string {
  return PRIORITY_META[priority].label.toLowerCase()
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
    clauses.push(`it is in ${statusName(vocabulary, conditions.if_status_id)}`)
  }
  if (conditions.if_priority != null) {
    clauses.push(`its priority is ${priorityName(conditions.if_priority)}`)
  }
  if (conditions.if_label_id != null) {
    clauses.push(`it has the label ${labelName(vocabulary, conditions.if_label_id)}`)
  }
  if (conditions.if_project_id != null) {
    clauses.push(`it is in ${projectName(vocabulary, conditions.if_project_id)}`)
  }
  if (conditions.if_unassigned) {
    clauses.push('nobody is assigned')
  } else if (conditions.if_assignee_id != null) {
    clauses.push(
      `it is assigned to ${personName(vocabulary, conditions.if_assignee_id)}`,
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
    clauses.push(`set its status to ${statusName(vocabulary, actions.set_status_id)}`)
  }
  if (actions.set_priority != null) {
    clauses.push(`set its priority to ${priorityName(actions.set_priority)}`)
  }
  if (actions.set_assignee_id != null) {
    clauses.push(`assign it to ${personName(vocabulary, actions.set_assignee_id)}`)
  }
  if (actions.add_label_id != null) {
    clauses.push(`add the label ${labelName(vocabulary, actions.add_label_id)}`)
  }
  if (actions.move_to_active_cycle) {
    clauses.push('move it to the active cycle')
  } else if (actions.set_cycle_id != null) {
    clauses.push(`move it to ${cycleName(vocabulary, actions.set_cycle_id)}`)
  }
  if (actions.comment_body?.trim()) {
    clauses.push('post a comment')
  }
  return clauses
}

/** `["it is urgent", "it has the label bug"]` → `"it is urgent and it has the label bug"`. */
export function joinClauses(clauses: string[]): string {
  if (clauses.length <= 1) return clauses[0] ?? ''
  return `${clauses.slice(0, -1).join(', ')} and ${clauses[clauses.length - 1]}`
}

/** The whole rule as one sentence, for a list row and for a screen reader. */
export function describeRule(
  rule: AutomationRuleRead,
  vocabulary: RuleVocabulary,
): string {
  const conditions = describeConditions(rule.conditions, vocabulary)
  const actions = describeActions(rule.actions, vocabulary)
  const when = `When ${TRIGGER_LABELS[rule.trigger]}`
  const If = conditions.length > 0 ? `, if ${joinClauses(conditions)}` : ''
  // A rule can be left with no actions when the cycle it filled is deleted;
  // it is switched off at the same time. Saying so beats an empty sentence.
  const then =
    actions.length > 0 ? `, ${joinClauses(actions)}.` : ', do nothing — this rule is empty.'
  return `${when}${If}${then}`
}

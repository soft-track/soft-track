import { useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { type FormEvent, useState } from 'react'
import { useParams } from 'react-router-dom'

import {
  getListRulesTeamsTeamIdAutomationRulesGetQueryKey,
  getListRunsTeamsTeamIdAutomationRunsGetQueryKey,
  useCreateRuleTeamsTeamIdAutomationRulesPost,
  useDeleteRuleAutomationRulesRuleIdDelete,
  useListRulesTeamsTeamIdAutomationRulesGet,
  useListRunsTeamsTeamIdAutomationRunsGet,
  useUpdateRuleAutomationRulesRuleIdPatch,
} from '@/api/generated/endpoints/automations/automations'
import { useListTeamMembersTeamsTeamIdMembersGet } from '@/api/generated/endpoints/teams/teams'
import {
  AutomationTrigger,
  CycleState,
  IssuePriority,
  type AutomationRuleRead,
  type AutomationRunRead,
  type RuleActions,
  type RuleConditions,
  type TeamRead,
} from '@/api/generated/models'
import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/AuthContext'
import {
  TRIGGER_LABELS,
  describeActions,
  describeConditions,
  joinClauses,
  type RuleVocabulary,
} from '@/automations/ruleText'
import { PRIORITY_META, PRIORITY_ORDER } from '@/issues/issueMeta'
import { useTeamByKey } from '@/team/useTeams'
import { useTeamData } from '@/team/useTeamData'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Select } from '@/ui/Select'

/** How much of the log the page shows. Older runs are in the table, not here. */
const RECENT_RUNS = 20

const TRIGGER_ORDER: AutomationTrigger[] = [
  AutomationTrigger.issue_created,
  AutomationTrigger.status_changed,
  AutomationTrigger.issue_assigned,
  AutomationTrigger.comment_added,
  AutomationTrigger.cycle_completed,
]

const EMPTY_CONDITIONS: RuleConditions = { if_unassigned: false }
const EMPTY_ACTIONS: RuleActions = { move_to_active_cycle: false }

export default function TeamAutomationSettings() {
  const { teamKey } = useParams()
  const { team, isLoading } = useTeamByKey(teamKey)
  const { user } = useAuth()

  const members = useListTeamMembersTeamsTeamIdMembersGet(team?.id ?? 0, {
    query: { enabled: Boolean(team) },
  })
  const isAdmin =
    members.data?.some((m) => m.user.id === user?.id && m.role === 'admin') ?? false

  if (isLoading) return <Loading />
  if (!team) {
    return (
      <div className="glass-strong rounded-panel p-6 text-sm text-neutral-500">
        That team does not exist, or you are not a member of it.
      </div>
    )
  }
  return <Automation key={team.id} team={team} isAdmin={isAdmin} />
}

function Automation({ team, isAdmin }: { team: TeamRead; isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const { statuses, labels, projects, members, cycles } = useTeamData(team)
  const vocabulary: RuleVocabulary = { statuses, labels, projects, members, cycles }

  const rules = useListRulesTeamsTeamIdAutomationRulesGet(team.id)
  const runs = useListRunsTeamsTeamIdAutomationRunsGet(team.id, { limit: RECENT_RUNS })
  const create = useCreateRuleTeamsTeamIdAutomationRulesPost()
  const update = useUpdateRuleAutomationRulesRuleIdPatch()
  const remove = useDeleteRuleAutomationRulesRuleIdDelete()

  const [error, setError] = useState<string | null>(null)
  // `null` is closed; a rule is "edit this one"; `'new'` is the blank form.
  const [editing, setEditing] = useState<AutomationRuleRead | 'new' | null>(null)

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: getListRulesTeamsTeamIdAutomationRulesGetQueryKey(team.id),
      }),
      // The log too: switching a rule off does not write one, but saving a
      // rule is exactly when somebody looks at what it has been doing.
      queryClient.invalidateQueries({
        queryKey: getListRunsTeamsTeamIdAutomationRunsGetQueryKey(team.id),
      }),
    ])

  const run = async (work: () => Promise<unknown>, fallback: string) => {
    setError(null)
    try {
      await work()
      await refresh()
      return true
    } catch (err: unknown) {
      setError(errorDetail(err, fallback))
      return false
    }
  }

  if (rules.isLoading) return <Loading />

  const items = rules.data ?? []

  return (
    <div className="space-y-4">
      <div className="glass-strong sheen rounded-panel p-6">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
          Automation
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Rules that do {team.name}’s bookkeeping for it.
        </p>

        <p className="mt-4 text-sm text-neutral-600">
          A rule is one <strong>trigger</strong>, any number of{' '}
          <strong>conditions</strong>, and the <strong>actions</strong> to take on an
          issue that matches. Rules run in the order they are listed, and a rule’s own
          changes never set off another rule — so one thing happening is one pass, and
          two rules can never chase each other. Everything a rule does is in the log
          below.
        </p>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </div>
        )}

        {items.length === 0 ? (
          <p className="mt-5 text-sm text-neutral-400">
            No rules yet. Nothing happens on this team that somebody did not do.
          </p>
        ) : (
          <ul className="mt-5 space-y-1.5">
            {items.map((rule) => (
              <li
                key={rule.id}
                className="well flex items-start gap-3 rounded-control px-3 py-2.5"
              >
                <input
                  type="checkbox"
                  checked={rule.is_enabled}
                  disabled={!isAdmin}
                  aria-label={`${rule.name} is on`}
                  onChange={(e) =>
                    run(
                      () =>
                        update.mutateAsync({
                          ruleId: rule.id,
                          data: { is_enabled: e.target.checked },
                        }),
                      'Could not switch that rule.',
                    )
                  }
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand-600)]"
                />
                <div
                  className="min-w-0 flex-1"
                  style={{ opacity: rule.is_enabled ? 1 : 0.5 }}
                >
                  <p className="truncate text-sm font-medium text-neutral-900">
                    {rule.name}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">
                    <RuleSentence rule={rule} vocabulary={vocabulary} />
                  </p>
                </div>

                {isAdmin && (
                  <span className="flex shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() => setEditing(rule)}
                      aria-label={`Edit ${rule.name}`}
                      className="btn btn-ghost btn-xs text-neutral-400"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        run(
                          () => remove.mutateAsync({ ruleId: rule.id }),
                          'Could not delete that rule.',
                        )
                      }
                      aria-label={`Delete ${rule.name}`}
                      title="Delete this rule. What it has already done stays in the log."
                      className="btn btn-ghost btn-icon btn-xs text-neutral-400 hover:text-danger-600"
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {isAdmin ? (
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="btn btn-secondary btn-sm mt-3"
          >
            <Icon name="plus" size={13} />
            Add a rule
          </button>
        ) : (
          <p className="mt-4 text-xs text-neutral-400">
            Only team admins can change the rules. Anyone can read them, and the log
            below.
          </p>
        )}
      </div>

      <RunLog
        runs={runs.data?.items ?? []}
        total={runs.data?.total ?? 0}
        isLoading={runs.isLoading}
      />

      {editing && (
        <RuleEditor
          rule={editing === 'new' ? null : editing}
          team={team}
          vocabulary={vocabulary}
          onClose={() => setEditing(null)}
          onSave={async (payload) => {
            const ok = await run(
              () =>
                editing === 'new'
                  ? create.mutateAsync({ teamId: team.id, data: payload })
                  : update.mutateAsync({ ruleId: editing.id, data: payload }),
              'Could not save that rule.',
            )
            if (ok) setEditing(null)
          }}
        />
      )}
    </div>
  )
}

/** A rule read back as the sentence somebody meant by it. See ruleText.ts. */
function RuleSentence({
  rule,
  vocabulary,
}: {
  rule: AutomationRuleRead
  vocabulary: RuleVocabulary
}) {
  const conditions = describeConditions(rule.conditions, vocabulary)
  const actions = describeActions(rule.actions, vocabulary)
  return (
    <>
      When {TRIGGER_LABELS[rule.trigger]}
      {conditions.length > 0 && <>, if {joinClauses(conditions)}</>},{' '}
      {actions.length > 0 ? (
        joinClauses(actions)
      ) : (
        // Deleting a cycle strips the action out of the rules that filled it
        // and switches them off. Saying so beats trailing off.
        <span className="text-danger-600">
          do nothing — this rule lost its action and was switched off
        </span>
      )}
      .
    </>
  )
}

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

/**
 * What the rules have actually done.
 *
 * On the same page as the rules rather than behind a tab, because the question
 * it answers -- "why did my issue move" -- is asked by somebody who is already
 * suspicious of a rule, and a log they have to go looking for is a log they do
 * not find.
 */
function RunLog({
  runs,
  total,
  isLoading,
}: {
  runs: AutomationRunRead[]
  total: number
  isLoading: boolean
}) {
  return (
    <div className="glass-strong rounded-panel p-6">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-neutral-800">Recent activity</h2>
        {total > 0 && (
          <span className="identifier rounded-full bg-neutral-900/6 px-1.5 py-0.5 text-[11px] font-medium text-neutral-500">
            {total}
          </span>
        )}
      </div>

      {isLoading ? (
        <Loading />
      ) : runs.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-400">
          Nothing yet. Every change a rule makes is recorded here.
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {runs.map((entry) => (
            <li key={entry.id} className="flex gap-2.5">
              <span
                className="mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-full bg-neutral-900/8 text-neutral-500"
                aria-hidden="true"
              >
                <Icon name="sparkle" size={12} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-neutral-600">
                  <span className="font-medium text-neutral-900">
                    {entry.rule_name}
                  </span>
                  {entry.rule_id === null && (
                    // The rule is gone; the row is why the log outlives it.
                    <span className="text-neutral-400"> (deleted)</span>
                  )}{' '}
                  on <span className="identifier">{entry.issue_identifier}</span>{' '}
                  <span className="text-neutral-400">{entry.issue_title}</span>
                </p>
                <p className="mt-0.5 whitespace-pre-line text-xs text-neutral-500">
                  {entry.summary}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-neutral-400">
                  {entry.actor ? (
                    <>
                      <Avatar user={entry.actor} size={14} />
                      after {entry.actor.full_name}
                    </>
                  ) : (
                    'no one'
                  )}
                  <span aria-hidden="true">·</span>
                  {formatDistanceToNow(parseServerDate(entry.created_at), {
                    addSuffix: true,
                  })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

/** `''` in a select means "no opinion"; the API wants null. */
function idOrNull(value: string): number | null {
  return value === '' ? null : Number(value)
}

function asText(value: number | null | undefined): string {
  return value == null ? '' : String(value)
}

/**
 * One rule, written as a form.
 *
 * The two halves are labelled "If" and "Then" rather than "conditions" and
 * "actions": the whole point of keeping the model this small is that a rule
 * can be read as a sentence, and the form is where the sentence gets written.
 */
function RuleEditor({
  rule,
  team,
  vocabulary,
  onClose,
  onSave,
}: {
  rule: AutomationRuleRead | null
  team: TeamRead
  vocabulary: RuleVocabulary
  onClose: () => void
  onSave: (payload: {
    name: string
    trigger: AutomationTrigger
    conditions: RuleConditions
    actions: RuleActions
  }) => Promise<void>
}) {
  const [name, setName] = useState(rule?.name ?? '')
  const [trigger, setTrigger] = useState<AutomationTrigger>(
    rule?.trigger ?? AutomationTrigger.issue_created,
  )
  const [conditions, setConditions] = useState<RuleConditions>(
    rule?.conditions ?? EMPTY_CONDITIONS,
  )
  const [actions, setActions] = useState<RuleActions>(rule?.actions ?? EMPTY_ACTIONS)
  const [saving, setSaving] = useState(false)

  // A completed cycle's numbers are history, so the API refuses to point a
  // rule at one. Leaving it out of the list is how that reads as a rule of the
  // feature rather than as an error somebody had to trip over.
  const openCycles = vocabulary.cycles.filter(
    (cycle) => cycle.state !== CycleState.completed,
  )

  const setCondition = (patch: Partial<RuleConditions>) =>
    setConditions((current) => ({ ...current, ...patch }))
  const setAction = (patch: Partial<RuleActions>) =>
    setActions((current) => ({ ...current, ...patch }))

  const preview = [
    `When ${TRIGGER_LABELS[trigger]}`,
    describeConditions(conditions, vocabulary).length > 0
      ? `, if ${joinClauses(describeConditions(conditions, vocabulary))}`
      : '',
    describeActions(actions, vocabulary).length > 0
      ? `, ${joinClauses(describeActions(actions, vocabulary))}.`
      : ' — this rule needs at least one action.',
  ].join('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await onSave({ name: name.trim(), trigger, conditions, actions })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="scrim fixed inset-0 z-30 flex items-start justify-center overflow-y-auto px-4 py-[8vh]"
      onClick={onClose}
    >
      <form
        role="dialog"
        aria-label={rule ? `Edit ${rule.name}` : 'New automation rule'}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="pop-in glass-strong w-full max-w-lg rounded-panel p-5"
      >
        <h2 className="text-base font-semibold tracking-tight text-neutral-900">
          {rule ? `Edit “${rule.name}”` : 'New rule'}
        </h2>

        <label className="mt-4 block">
          <span className="eyebrow mb-1 block">Name</span>
          <input
            autoFocus
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Triage urgent bugs"
            className="field field-sm w-full"
          />
        </label>

        <label className="mt-3 block">
          <span className="eyebrow mb-1 block">When</span>
          <Select
            dense
            block
            value={trigger}
            onChange={(e) => setTrigger(e.target.value as AutomationTrigger)}
          >
            {TRIGGER_ORDER.map((value) => (
              <option key={value} value={value}>
                {TRIGGER_LABELS[value]}
              </option>
            ))}
          </Select>
        </label>

        <fieldset className="hairline mt-4 border-t pt-3">
          <legend className="eyebrow">If — leave blank for “any issue”</legend>

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Field label="Status is">
              <Select
                dense
                block
                value={asText(conditions.if_status_id)}
                onChange={(e) => setCondition({ if_status_id: idOrNull(e.target.value) })}
              >
                <option value="">Any</option>
                {vocabulary.statuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Priority is">
              <Select
                dense
                block
                value={conditions.if_priority ?? ''}
                onChange={(e) =>
                  setCondition({
                    if_priority: (e.target.value || null) as IssuePriority | null,
                  })
                }
              >
                <option value="">Any</option>
                {PRIORITY_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {PRIORITY_META[value].label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Has the label">
              <Select
                dense
                block
                value={asText(conditions.if_label_id)}
                onChange={(e) => setCondition({ if_label_id: idOrNull(e.target.value) })}
              >
                <option value="">Any</option>
                {vocabulary.labels.map((label) => (
                  <option key={label.id} value={label.id}>
                    {label.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="In the project">
              <Select
                dense
                block
                value={asText(conditions.if_project_id)}
                onChange={(e) =>
                  setCondition({ if_project_id: idOrNull(e.target.value) })
                }
              >
                <option value="">Any</option>
                {vocabulary.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Assigned to">
              <Select
                dense
                block
                // "Nobody" and "anybody" are different questions, and the API
                // refuses a rule that asks both -- so one control asks one.
                value={
                  conditions.if_unassigned
                    ? 'unassigned'
                    : asText(conditions.if_assignee_id)
                }
                onChange={(e) =>
                  setCondition(
                    e.target.value === 'unassigned'
                      ? { if_unassigned: true, if_assignee_id: null }
                      : {
                          if_unassigned: false,
                          if_assignee_id: idOrNull(e.target.value),
                        },
                  )
                }
              >
                <option value="">Anyone</option>
                <option value="unassigned">Nobody</option>
                {vocabulary.members.map((member) => (
                  <option key={member.user.id} value={member.user.id}>
                    {member.user.full_name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </fieldset>

        <fieldset className="hairline mt-4 border-t pt-3">
          <legend className="eyebrow">Then — at least one</legend>

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Field label="Set status to">
              <Select
                dense
                block
                value={asText(actions.set_status_id)}
                onChange={(e) => setAction({ set_status_id: idOrNull(e.target.value) })}
              >
                <option value="">Leave it</option>
                {vocabulary.statuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Set priority to">
              <Select
                dense
                block
                value={actions.set_priority ?? ''}
                onChange={(e) =>
                  setAction({
                    set_priority: (e.target.value || null) as IssuePriority | null,
                  })
                }
              >
                <option value="">Leave it</option>
                {PRIORITY_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {PRIORITY_META[value].label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Assign to">
              <Select
                dense
                block
                value={asText(actions.set_assignee_id)}
                onChange={(e) =>
                  setAction({ set_assignee_id: idOrNull(e.target.value) })
                }
              >
                <option value="">Leave it</option>
                {vocabulary.members.map((member) => (
                  <option key={member.user.id} value={member.user.id}>
                    {member.user.full_name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Add the label">
              <Select
                dense
                block
                value={asText(actions.add_label_id)}
                onChange={(e) => setAction({ add_label_id: idOrNull(e.target.value) })}
              >
                <option value="">None</option>
                {vocabulary.labels.map((label) => (
                  <option key={label.id} value={label.id}>
                    {label.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Move to cycle" className="sm:col-span-2">
              <Select
                dense
                block
                value={
                  actions.move_to_active_cycle
                    ? 'active'
                    : asText(actions.set_cycle_id)
                }
                onChange={(e) =>
                  setAction(
                    e.target.value === 'active'
                      ? { move_to_active_cycle: true, set_cycle_id: null }
                      : {
                          move_to_active_cycle: false,
                          set_cycle_id: idOrNull(e.target.value),
                        },
                  )
                }
              >
                <option value="">Leave it</option>
                {/* Above the named ones because it is the one that keeps
                    meaning "the sprint" a fortnight from now. */}
                <option value="active">Whichever cycle is active</option>
                {openCycles.map((cycle) => (
                  <option key={cycle.id} value={cycle.id}>
                    {cycle.display_name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <label className="mt-2 block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">
              Post a comment
            </span>
            <textarea
              rows={2}
              maxLength={2000}
              value={actions.comment_body ?? ''}
              onChange={(e) => setAction({ comment_body: e.target.value || null })}
              placeholder="Filed outside a cycle — please size it."
              className="field field-sm w-full resize-y"
            />
            <span className="mt-1 block text-[11px] text-neutral-400">
              Posted with no author, so nobody is quoted saying something they did
              not write.
            </span>
          </label>
        </fieldset>

        <p className="well mt-4 rounded-control px-3 py-2 text-xs text-neutral-600">
          {preview}
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
            {saving ? 'Saving…' : rule ? 'Save the rule' : `Add it to ${team.key}`}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({
  label,
  className = '',
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 block text-xs font-medium text-neutral-500">{label}</span>
      {children}
    </label>
  )
}

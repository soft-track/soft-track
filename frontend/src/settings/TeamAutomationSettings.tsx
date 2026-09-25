import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
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
  IssueType,
  type AutomationRuleRead,
  type AutomationRunRead,
  type RuleActions,
  type RuleConditions,
  type TeamRead,
} from '@/api/generated/models'
import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/useAuth'
import {
  TRIGGER_LABELS,
  describeActions,
  describeConditions,
  joinClauses,
  type RuleVocabulary,
} from '@/automations/ruleText'
import { Trans, userText, useTranslation } from '@/i18n'
import { formatRelative } from '@/i18n/format'
import { PRIORITY_META, PRIORITY_ORDER, TYPE_META, TYPE_ORDER } from '@/issues/issueMeta'
import { pickableProjects } from '@/team/projects'
import { useTeamByKey } from '@/team/useTeams'
import { useTeamData } from '@/team/useTeamData'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Select } from '@/ui/Select'
import { useFocusTrap } from '@/ui/useFocusTrap'

/** How much of the log the page shows. Older runs are in the table, not here. */
const RECENT_RUNS = 20

const TRIGGER_ORDER: AutomationTrigger[] = [
  AutomationTrigger.issue_created,
  AutomationTrigger.status_changed,
  AutomationTrigger.issue_assigned,
  AutomationTrigger.comment_added,
  AutomationTrigger.cycle_completed,
  // The three that arrive from a connected repository rather than from
  // somebody using the tracker. Last because a team with no repository
  // connected can still pick them, and they would do nothing.
  AutomationTrigger.branch_created,
  AutomationTrigger.pull_request_opened,
  AutomationTrigger.pull_request_merged,
]

const EMPTY_CONDITIONS: RuleConditions = { if_unassigned: false }
const EMPTY_ACTIONS: RuleActions = { move_to_active_cycle: false }

export default function TeamAutomationSettings() {
  const { teamKey } = useParams()
  const { team, isLoading } = useTeamByKey(teamKey)
  const { user } = useAuth()
  const { t } = useTranslation(['settings', 'common'])

  const members = useListTeamMembersTeamsTeamIdMembersGet(team?.id ?? 0, {
    query: { enabled: Boolean(team) },
  })
  const isAdmin =
    members.data?.some((m) => m.user.id === user?.id && m.role === 'admin') ?? false

  if (isLoading) return <Loading />
  if (!team) {
    return (
      <div className="glass-strong rounded-panel p-6 text-sm text-neutral-500">
        {t('common:teamNotFound')}
      </div>
    )
  }
  return <Automation key={team.id} team={team} isAdmin={isAdmin} />
}

function Automation({ team, isAdmin }: { team: TeamRead; isAdmin: boolean }) {
  const { t } = useTranslation(['settings', 'common'])
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
          {t('automation.title')}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {t('automation.intro', { team: team.name })}
        </p>

        <p className="mt-4 text-sm text-neutral-600">
          <Trans t={t} i18nKey="automation.explainer" components={{ strong: <strong /> }} />
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
          <p className="mt-5 text-sm text-neutral-400">{t('automation.empty')}</p>
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
                  aria-label={t('automation.isOn', { name: rule.name })}
                  onChange={(e) =>
                    run(
                      () =>
                        update.mutateAsync({
                          ruleId: rule.id,
                          data: { is_enabled: e.target.checked },
                        }),
                      t('automation.errors.toggle'),
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
                      aria-label={t('automation.editNamed', { name: rule.name })}
                      className="btn btn-ghost btn-xs text-neutral-400"
                    >
                      {t('common:edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        run(
                          () => remove.mutateAsync({ ruleId: rule.id }),
                          t('automation.errors.delete'),
                        )
                      }
                      aria-label={t('automation.deleteNamed', { name: rule.name })}
                      title={t('automation.deleteHint')}
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
            {t('automation.addRule')}
          </button>
        ) : (
          <p className="mt-4 text-xs text-neutral-400">{t('automation.adminsOnly')}</p>
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
              t('automation.errors.save'),
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
  const { t } = useTranslation(['settings', 'common'])
  const conditions = describeConditions(rule.conditions, vocabulary)
  const actions = describeActions(rule.actions, vocabulary)
  const trigger = TRIGGER_LABELS[rule.trigger]
  const hasConditions = conditions.length > 0

  if (actions.length > 0) {
    return hasConditions
      ? t('automation.sentence.ifThen', {
          trigger,
          conditions: joinClauses(conditions),
          actions: joinClauses(actions),
        })
      : t('automation.sentence.then', { trigger, actions: joinClauses(actions) })
  }
  // Deleting a cycle strips the action out of the rules that filled it
  // and switches them off. Saying so beats trailing off.
  return (
    <Trans
      t={t}
      i18nKey={
        hasConditions ? 'automation.sentence.ifLostAction' : 'automation.sentence.lostAction'
      }
      values={{ trigger, conditions: joinClauses(conditions) }}
      components={{ danger: <span className="text-danger-600" /> }}
      {...userText}
    />
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
  const { t } = useTranslation(['settings', 'common'])
  return (
    <div className="glass-strong rounded-panel p-6">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-neutral-800">
          {t('automation.runLog.title')}
        </h2>
        {total > 0 && (
          <span className="identifier rounded-full bg-neutral-900/6 px-1.5 py-0.5 text-[11px] font-medium text-neutral-500">
            {total}
          </span>
        )}
      </div>

      {isLoading ? (
        <Loading />
      ) : runs.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-400">{t('automation.runLog.empty')}</p>
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
                  <Trans
                    t={t}
                    i18nKey={
                      // The rule is gone; the row is why the log outlives it.
                      entry.rule_id === null
                        ? 'automation.runLog.entryDeleted'
                        : 'automation.runLog.entry'
                    }
                    values={{
                      rule: entry.rule_name,
                      identifier: entry.issue_identifier,
                      title: entry.issue_title,
                    }}
                    components={{
                      rule: <span className="font-medium text-neutral-900" />,
                      issue: <span className="identifier" />,
                      muted: <span className="text-neutral-400" />,
                    }}
                    {...userText}
                  />
                </p>
                <p className="mt-0.5 whitespace-pre-line text-xs text-neutral-500">
                  {entry.summary}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-neutral-400">
                  {entry.actor ? (
                    <>
                      <Avatar user={entry.actor} size={14} decorative />
                      {t('automation.runLog.after', { name: entry.actor.full_name })}
                    </>
                  ) : (
                    t('automation.runLog.noOne')
                  )}
                  <span aria-hidden="true">·</span>
                  {formatRelative(parseServerDate(entry.created_at))}
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
  const { t } = useTranslation(['settings', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
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

  const conditionClauses = describeConditions(conditions, vocabulary)
  const actionClauses = describeActions(actions, vocabulary)
  const sentence = {
    trigger: TRIGGER_LABELS[trigger],
    conditions: joinClauses(conditionClauses),
    actions: joinClauses(actionClauses),
  }
  const preview =
    actionClauses.length > 0
      ? conditionClauses.length > 0
        ? t('automation.sentence.ifThen', sentence)
        : t('automation.sentence.then', sentence)
      : conditionClauses.length > 0
        ? t('automation.sentence.ifNeedsAction', sentence)
        : t('automation.sentence.needsAction', sentence)

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
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="pop-in glass-strong w-full max-w-lg rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          {rule
            ? t('automation.editor.editTitle', { name: rule.name })
            : t('automation.editor.newTitle')}
        </h2>

        <label className="mt-4 block">
          <span className="eyebrow mb-1 block">{t('automation.editor.nameLabel')}</span>
          <input
            autoFocus
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('automation.editor.namePlaceholder')}
            className="field field-sm w-full"
          />
        </label>

        <label className="mt-3 block">
          <span className="eyebrow mb-1 block">{t('automation.editor.whenLabel')}</span>
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
          <legend className="eyebrow">{t('automation.editor.ifLegend')}</legend>

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Field label={t('automation.editor.statusIs')}>
              <Select
                dense
                block
                value={asText(conditions.if_status_id)}
                onChange={(e) => setCondition({ if_status_id: idOrNull(e.target.value) })}
              >
                <option value="">{t('automation.editor.any')}</option>
                {vocabulary.statuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('automation.editor.priorityIs')}>
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
                <option value="">{t('automation.editor.any')}</option>
                {PRIORITY_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {PRIORITY_META[value].label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('automation.editor.typeIs')}>
              <Select
                dense
                block
                value={conditions.if_type ?? ''}
                onChange={(e) =>
                  setCondition({ if_type: (e.target.value || null) as IssueType | null })
                }
              >
                <option value="">{t('automation.editor.any')}</option>
                {TYPE_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {TYPE_META[value].label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('automation.editor.hasLabel')}>
              <Select
                dense
                block
                value={asText(conditions.if_label_id)}
                onChange={(e) => setCondition({ if_label_id: idOrNull(e.target.value) })}
              >
                <option value="">{t('automation.editor.any')}</option>
                {vocabulary.labels.map((label) => (
                  <option key={label.id} value={label.id}>
                    {label.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('automation.editor.inProject')}>
              <Select
                dense
                block
                value={asText(conditions.if_project_id)}
                onChange={(e) =>
                  setCondition({ if_project_id: idOrNull(e.target.value) })
                }
              >
                <option value="">{t('automation.editor.any')}</option>
                {pickableProjects(vocabulary.projects, conditions.if_project_id).map(
                  (project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ),
                )}
              </Select>
            </Field>

            <Field label={t('automation.editor.assignedTo')}>
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
                <option value="">{t('automation.editor.anyone')}</option>
                <option value="unassigned">{t('automation.editor.nobody')}</option>
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
          <legend className="eyebrow">{t('automation.editor.thenLegend')}</legend>

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Field label={t('automation.editor.setStatus')}>
              <Select
                dense
                block
                value={asText(actions.set_status_id)}
                onChange={(e) => setAction({ set_status_id: idOrNull(e.target.value) })}
              >
                <option value="">{t('automation.editor.leaveIt')}</option>
                {vocabulary.statuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('automation.editor.setPriority')}>
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
                <option value="">{t('automation.editor.leaveIt')}</option>
                {PRIORITY_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {PRIORITY_META[value].label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('automation.editor.setType')}>
              <Select
                dense
                block
                value={actions.set_type ?? ''}
                onChange={(e) =>
                  setAction({ set_type: (e.target.value || null) as IssueType | null })
                }
              >
                <option value="">{t('automation.editor.leaveIt')}</option>
                {TYPE_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {TYPE_META[value].label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('automation.editor.assignTo')}>
              <Select
                dense
                block
                value={asText(actions.set_assignee_id)}
                onChange={(e) =>
                  setAction({ set_assignee_id: idOrNull(e.target.value) })
                }
              >
                <option value="">{t('automation.editor.leaveIt')}</option>
                {vocabulary.members.map((member) => (
                  <option key={member.user.id} value={member.user.id}>
                    {member.user.full_name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('automation.editor.addLabel')}>
              <Select
                dense
                block
                value={asText(actions.add_label_id)}
                onChange={(e) => setAction({ add_label_id: idOrNull(e.target.value) })}
              >
                <option value="">{t('automation.editor.none')}</option>
                {vocabulary.labels.map((label) => (
                  <option key={label.id} value={label.id}>
                    {label.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('automation.editor.moveToCycle')} className="sm:col-span-2">
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
                <option value="">{t('automation.editor.leaveIt')}</option>
                {/* Above the named ones because it is the one that keeps
                    meaning "the sprint" a fortnight from now. */}
                <option value="active">{t('automation.editor.activeCycle')}</option>
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
              {t('automation.editor.commentLabel')}
            </span>
            <textarea
              rows={2}
              maxLength={2000}
              value={actions.comment_body ?? ''}
              onChange={(e) => setAction({ comment_body: e.target.value || null })}
              placeholder={t('automation.editor.commentPlaceholder')}
              className="field field-sm w-full resize-y"
            />
            <span className="mt-1 block text-[11px] text-neutral-400">
              {t('automation.editor.commentHint')}
            </span>
          </label>
        </fieldset>

        <p className="well mt-4 rounded-control px-3 py-2 text-xs text-neutral-600">
          {preview}
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
            {t('common:cancel')}
          </button>
          <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
            {saving
              ? t('common:saving')
              : rule
                ? t('automation.editor.save')
                : t('automation.editor.addTo', { team: team.key })}
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

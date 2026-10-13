import { useQueryClient } from '@tanstack/react-query'
import { parseISO } from 'date-fns'
import { type FormEvent, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  getListSchedulesTeamsTeamIdTicketSchedulesGetQueryKey,
  useCreateScheduleTeamsTeamIdTicketSchedulesPost,
  useDeleteScheduleTicketSchedulesScheduleIdDelete,
  useListSchedulesTeamsTeamIdTicketSchedulesGet,
  useUpdateScheduleTicketSchedulesScheduleIdPatch,
} from '@/api/generated/endpoints/schedules/schedules'
import { useListTemplatesTeamsTeamIdTicketTemplatesGet } from '@/api/generated/endpoints/templates/templates'
import type {
  Frequency,
  LabelRead,
  MonthDay,
  ProjectRead,
  ScheduleFields,
  ScheduleRead,
  TeamMemberRead,
  TeamRead,
  TicketPriority,
  TicketType,
} from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import {
  describeRepeat,
  describeSchedule,
  describeWhat,
  monthName,
  nextDay,
  weekdayName,
} from '@/automations/scheduleText'
import { i18n, useTranslation } from '@/i18n'
import { formatDate, formatList } from '@/i18n/format'
import { AssigneeOptions } from '@/tickets/AssigneeOptions'
import {
  ESTIMATE_SCALE,
  PRIORITY_META,
  PRIORITY_ORDER,
  TYPE_META,
  TYPE_ORDER,
} from '@/tickets/ticketMeta'
import { replacingLosesWork } from '@/tickets/templates'
import { pickableProjects } from '@/team/projects'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Select } from '@/ui/Select'
import { useFocusTrap } from '@/ui/useFocusTrap'

const FREQUENCIES: Frequency[] = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']
/** The days the dialog offers, Monday to Friday; "every day" is the weekend's. */
const WORKING_WEEK = [0, 1, 2, 3, 4]
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

const BLANK: ScheduleFields = {
  title: '',
  description: null,
  type: 'task',
  priority: 'no_priority',
  assignee_id: null,
  label_ids: [],
  project_id: null,
  estimate: null,
  due_after_days: null,
  into_active_sprint: false,
  frequency: 'weekly',
  interval: 1,
  weekdays: [0],
  month_day: null,
  day_of_month: null,
  month: null,
  wait_for_previous: false,
}

/**
 * Recurring tickets (#264), beside the automation rules: work that comes back
 * on a date rather than in answer to something happening.
 */
export function TeamSchedules({
  team,
  isAdmin,
  members,
  labels,
  projects,
}: {
  team: TeamRead
  isAdmin: boolean
  members: TeamMemberRead[]
  labels: LabelRead[]
  projects: ProjectRead[]
}) {
  const { t } = useTranslation(['settings', 'common'])
  const queryClient = useQueryClient()
  const schedules = useListSchedulesTeamsTeamIdTicketSchedulesGet(team.id)
  const create = useCreateScheduleTeamsTeamIdTicketSchedulesPost()
  const update = useUpdateScheduleTicketSchedulesScheduleIdPatch()
  const remove = useDeleteScheduleTicketSchedulesScheduleIdDelete()

  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ScheduleRead | 'new' | null>(null)

  const run = async (work: () => Promise<unknown>, fallback: string) => {
    setError(null)
    try {
      await work()
      await queryClient.invalidateQueries({
        queryKey: getListSchedulesTeamsTeamIdTicketSchedulesGetQueryKey(team.id),
      })
      return true
    } catch (err: unknown) {
      setError(errorDetail(err, fallback))
      return false
    }
  }

  const items = schedules.data ?? []

  return (
    <div className="glass-strong rounded-panel p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-neutral-800">{t('schedules.title')}</h2>
          <p className="mt-1 text-sm text-neutral-500">{t('schedules.intro')}</p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="btn btn-secondary btn-sm shrink-0"
          >
            <Icon name="plus" size={13} />
            {t('schedules.add')}
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
        >
          {error}
        </div>
      )}

      {schedules.isLoading ? (
        <Loading />
      ) : items.length === 0 ? (
        <p className="mt-5 text-sm text-neutral-400">{t('schedules.empty')}</p>
      ) : (
        <ul className="mt-4">
          {items.map((schedule) => (
            <ScheduleRow
              key={schedule.id}
              schedule={schedule}
              isAdmin={isAdmin}
              onToggle={(on) =>
                run(
                  () =>
                    update.mutateAsync({
                      scheduleId: schedule.id,
                      data: { paused: !on },
                    }),
                  t('schedules.errors.toggle'),
                )
              }
              onEdit={() => setEditing(schedule)}
              onRemove={() =>
                run(
                  () => remove.mutateAsync({ scheduleId: schedule.id }),
                  t('schedules.errors.remove'),
                )
              }
            />
          ))}
        </ul>
      )}

      {!isAdmin && <p className="mt-4 text-xs text-neutral-400">{t('schedules.adminsOnly')}</p>}

      {/* Out to the body: the panel's backdrop filter would otherwise be
          the box a fixed dialog is placed in. */}
      {editing &&
        createPortal(
          <ScheduleEditor
            schedule={editing === 'new' ? null : editing}
            team={team}
            members={members}
            labels={labels}
            projects={projects}
            onClose={() => setEditing(null)}
            onSave={async (payload) => {
              const ok = await run(
                () =>
                  editing === 'new'
                    ? create.mutateAsync({ teamId: team.id, data: payload })
                    : update.mutateAsync({
                        scheduleId: editing.id,
                        data: { schedule: payload },
                      }),
                t('schedules.errors.save'),
              )
              if (ok) setEditing(null)
            }}
          />,
          document.body,
        )}
    </div>
  )
}

function ScheduleRow({
  schedule,
  isAdmin,
  onToggle,
  onEdit,
  onRemove,
}: {
  schedule: ScheduleRead
  isAdmin: boolean
  onToggle: (on: boolean) => void
  onEdit: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const paused = schedule.paused_at != null
  const count = schedule.created_count ?? 0
  const recent = (schedule.recent_tickets ?? []).map((ticket) => ticket.identifier)

  let status: string
  if (paused) {
    status = t('schedules.pausedBy', {
      name: schedule.paused_by?.full_name ?? '',
      date: formatDate(parseISO(schedule.paused_at as string), t('schedules.pausedPattern')),
    })
  } else if (schedule.waiting_on) {
    status = t('schedules.waiting', { identifier: schedule.waiting_on.identifier })
  } else {
    const parts = []
    if (schedule.next_on) parts.push(t('schedules.next', { date: nextDay(schedule.next_on) }))
    if (count > 0) parts.push(t('schedules.createdSoFar', { count }))
    status = parts.join(' · ')
  }

  return (
    <li className="hairline flex items-center gap-4 border-b py-3.5 last:border-b-0">
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-control bg-brand-500/10 text-brand-600"
        style={{ opacity: paused ? 0.5 : 1 }}
        aria-hidden="true"
      >
        <Icon name="history" size={15} />
      </span>
      <div className="min-w-0 flex-1" style={{ opacity: paused ? 0.55 : 1 }}>
        <p className="truncate text-sm font-medium text-neutral-900">{schedule.title}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-neutral-600">
          {describeSchedule(schedule)}
        </p>
        {status && (
          <p
            className="mt-0.5 text-xs text-neutral-400"
            title={
              recent.length > 0
                ? madeSentence(recent, count)
                : undefined
            }
          >
            {status}
          </p>
        )}
      </div>
      <input
        type="checkbox"
        role="switch"
        className="switch shrink-0"
        checked={!paused}
        disabled={!isAdmin}
        aria-label={t('schedules.isOn', { name: schedule.title })}
        onChange={(e) => onToggle(e.target.checked)}
      />
      {isAdmin && <RowMenu name={schedule.title} onEdit={onEdit} onRemove={onRemove} />}
    </li>
  )
}

/** "It has created ENG-38, ENG-33, ENG-29 and 11 before them." */
function madeSentence(recent: string[], count: number): string {
  const more = count - recent.length
  return more > 0
    ? i18n.t('settings:schedules.madeMore', { tickets: recent.join(', '), more })
    : i18n.t('settings:schedules.made', { tickets: formatList(recent) })
}

function RowMenu({
  name,
  onEdit,
  onRemove,
}: {
  name: string
  onEdit: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation('settings')
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)

  useLayoutEffect(() => {
    if (open && buttonRef.current) setAnchor(buttonRef.current.getBoundingClientRect())
  }, [open])

  const choose = (action: () => void) => {
    setOpen(false)
    action()
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((it) => !it)}
        aria-label={t('schedules.actionsFor', { name })}
        aria-expanded={open}
        className="btn btn-ghost btn-icon btn-xs shrink-0 text-neutral-400"
      >
        <Icon name="more" size={14} />
      </button>
      {open &&
        anchor &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
            <div
              role="menu"
              aria-label={name}
              style={{
                top: anchor.bottom + 6,
                left: Math.max(8, Math.min(anchor.right - 160, window.innerWidth - 170)),
              }}
              className="glass-menu fixed z-50 w-40 rounded-panel p-1"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => choose(onEdit)}
                className="w-full rounded-control px-2.5 py-1.5 text-left text-xs text-neutral-700 transition-colors hover:bg-neutral-900/6"
              >
                {t('schedules.edit')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => choose(onRemove)}
                className="w-full rounded-control px-2.5 py-1.5 text-left text-xs text-danger-600 transition-colors hover:bg-neutral-900/6"
              >
                {t('schedules.remove')}
              </button>
            </div>
          </>,
          document.body,
        )}
    </>
  )
}

// ---------------------------------------------------------------------------
// The dialog
// ---------------------------------------------------------------------------

function fieldsOf(schedule: ScheduleRead | null): ScheduleFields {
  if (!schedule) return BLANK
  const fields = { ...BLANK }
  for (const key of Object.keys(BLANK) as (keyof ScheduleFields)[]) {
    if (schedule[key] !== undefined) (fields as Record<string, unknown>)[key] = schedule[key]
  }
  return fields
}

function numberOrNull(value: string): number | null {
  return value === '' ? null : Number(value)
}

function ScheduleEditor({
  schedule,
  team,
  members,
  labels,
  projects,
  onClose,
  onSave,
}: {
  schedule: ScheduleRead | null
  team: TeamRead
  members: TeamMemberRead[]
  labels: LabelRead[]
  projects: ProjectRead[]
  onClose: () => void
  onSave: (payload: ScheduleFields) => Promise<void>
}) {
  const { t } = useTranslation(['settings', 'common', 'tickets'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const templates = useListTemplatesTeamsTeamIdTicketTemplatesGet(team.id).data ?? []
  const [fields, setFields] = useState<ScheduleFields>(() => fieldsOf(schedule))
  const [templateId, setTemplateId] = useState('')
  const [appliedBody, setAppliedBody] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const set = (patch: Partial<ScheduleFields>) => setFields((current) => ({ ...current, ...patch }))
  const weekdays = fields.weekdays ?? []
  const labelIds = fields.label_ids ?? []
  const monthly = fields.frequency !== 'daily' && fields.frequency !== 'weekly'

  const setFrequency = (frequency: Frequency) =>
    set({
      frequency,
      weekdays: frequency === 'weekly' && weekdays.length === 0 ? [0] : weekdays,
      month_day:
        frequency === 'daily' || frequency === 'weekly'
          ? fields.month_day
          : (fields.month_day ?? 'first_working_day'),
      month: frequency === 'yearly' ? (fields.month ?? 1) : fields.month,
    })

  const toggleDay = (day: number) =>
    set({
      weekdays: weekdays.includes(day)
        ? weekdays.filter((d) => d !== day)
        : [...weekdays, day].sort(),
    })

  const toggleLabel = (id: number) =>
    set({
      label_ids: labelIds.includes(id) ? labelIds.filter((l) => l !== id) : [...labelIds, id],
    })

  const applyTemplate = (id: string) => {
    const template = templates.find((candidate) => String(candidate.id) === id)
    if (!template) {
      setTemplateId('')
      return
    }
    if (
      replacingLosesWork(fields.description ?? '', appliedBody) &&
      !window.confirm(t('schedules.editor.replaceDescription', { name: template.name }))
    )
      return
    setTemplateId(id)
    set({ description: template.body })
    setAppliedBody(template.body)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await onSave({
        ...fields,
        title: fields.title.trim(),
        description: fields.description?.trim() ? fields.description : null,
        day_of_month:
          fields.month_day === 'date' ? (fields.day_of_month ?? 1) : fields.day_of_month,
      })
    } finally {
      setSaving(false)
    }
  }

  const recent = (schedule?.recent_tickets ?? []).map((ticket) => ticket.identifier)

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
          {schedule ? t('schedules.editor.editTitle') : t('schedules.editor.newTitle')}
        </h2>

        <Field label={t('schedules.editor.whatLabel')} className="mt-4">
          <input
            autoFocus
            required
            maxLength={200}
            value={fields.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder={t('schedules.editor.whatPlaceholder')}
            className="field w-full"
          />
        </Field>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={t('schedules.editor.type')}>
            <Select
              block
              value={fields.type ?? 'task'}
              onChange={(e) => set({ type: e.target.value as TicketType })}
            >
              {TYPE_ORDER.map((value) => (
                <option key={value} value={value}>
                  {TYPE_META[value].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('schedules.editor.assignee')}>
            <Select
              block
              value={fields.assignee_id == null ? '' : String(fields.assignee_id)}
              onChange={(e) => set({ assignee_id: numberOrNull(e.target.value) })}
            >
              <option value="">{t('schedules.editor.unassigned')}</option>
              <AssigneeOptions members={members} keepId={fields.assignee_id} />
            </Select>
          </Field>
        </div>

        <Field label={t('schedules.editor.repeats')} className="mt-3">
          <Select
            block
            value={fields.frequency}
            onChange={(e) => setFrequency(e.target.value as Frequency)}
          >
            {FREQUENCIES.map((value) => (
              <option key={value} value={value}>
                {t(`schedules.editor.frequency.${value}`)}
              </option>
            ))}
          </Select>
        </Field>

        {fields.frequency === 'weekly' && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <div role="group" aria-label={t('schedules.editor.weekdays')} className="flex gap-1.5">
              {WORKING_WEEK.map((day) => {
                const active = weekdays.includes(day)
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={active}
                    aria-label={weekdayName(day)}
                    onClick={() => toggleDay(day)}
                    className={`btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    {weekdayName(day, 'EEE')}
                  </button>
                )
              })}
            </div>
            <label className="ml-auto flex items-center gap-1.5 text-xs text-neutral-500">
              <input
                type="number"
                min={1}
                max={52}
                value={fields.interval ?? 1}
                onChange={(e) => set({ interval: Math.max(1, Number(e.target.value) || 1) })}
                aria-label={t('schedules.editor.interval')}
                className="field field-sm w-14"
              />
              {t('schedules.editor.intervalSuffix')}
            </label>
          </div>
        )}

        {monthly && (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Field label={t('schedules.editor.on')}>
              <Select
                block
                value={fields.month_day ?? 'first_working_day'}
                onChange={(e) => set({ month_day: e.target.value as MonthDay })}
              >
                <option value="first_working_day">{t('schedules.editor.onFirst')}</option>
                <option value="last_working_day">{t('schedules.editor.onLast')}</option>
                <option value="date">{t('schedules.editor.onDate')}</option>
              </Select>
            </Field>
            {fields.month_day === 'date' && (
              <Field label={t('schedules.editor.dayOfMonth')}>
                <input
                  type="number"
                  min={1}
                  max={31}
                  required
                  value={fields.day_of_month ?? 1}
                  onChange={(e) => set({ day_of_month: numberOrNull(e.target.value) })}
                  className="field w-full"
                />
              </Field>
            )}
            {fields.frequency === 'yearly' && (
              <Field label={t('schedules.editor.month')}>
                <Select
                  block
                  value={String(fields.month ?? 1)}
                  onChange={(e) => set({ month: Number(e.target.value) })}
                >
                  {MONTHS.map((month) => (
                    <option key={month} value={month}>
                      {monthName(month)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        )}

        <details className="hairline mt-4 border-t pt-3">
          <summary className="cursor-pointer text-xs font-medium text-neutral-500">
            {t('schedules.editor.more')}
          </summary>

          {templates.length > 0 && (
            <Field label={t('schedules.editor.template')} className="mt-3">
              <Select block value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">{t('schedules.editor.noTemplate')}</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t('schedules.editor.description')} className="mt-3">
            <textarea
              rows={3}
              value={fields.description ?? ''}
              onChange={(e) => set({ description: e.target.value })}
              className="field field-sm w-full resize-y"
            />
          </Field>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label={t('schedules.editor.priority')}>
              <Select
                block
                value={fields.priority ?? 'no_priority'}
                onChange={(e) => set({ priority: e.target.value as TicketPriority })}
              >
                {PRIORITY_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {PRIORITY_META[value].label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('schedules.editor.estimate')}>
              <Select
                block
                value={fields.estimate == null ? '' : String(fields.estimate)}
                onChange={(e) =>
                  set({ estimate: numberOrNull(e.target.value) as ScheduleFields['estimate'] })
                }
              >
                <option value="">{t('schedules.editor.noEstimate')}</option>
                {ESTIMATE_SCALE.map((points) => (
                  <option key={points} value={points}>
                    {points}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('schedules.editor.epic')}>
              <Select
                block
                value={fields.project_id == null ? '' : String(fields.project_id)}
                onChange={(e) => set({ project_id: numberOrNull(e.target.value) })}
              >
                <option value="">{t('schedules.editor.noEpic')}</option>
                {pickableProjects(projects, fields.project_id).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('schedules.editor.landsIn')}>
              <Select
                block
                value={fields.into_active_sprint ? 'sprint' : 'backlog'}
                onChange={(e) => set({ into_active_sprint: e.target.value === 'sprint' })}
              >
                <option value="backlog">{t('schedules.editor.backlog')}</option>
                <option value="sprint">{t('schedules.editor.activeSprint')}</option>
              </Select>
            </Field>
            <Field label={t('schedules.editor.due')}>
              <Select
                block
                value={fields.due_after_days == null ? '' : 'after'}
                onChange={(e) => set({ due_after_days: e.target.value === 'after' ? 2 : null })}
              >
                <option value="">{t('schedules.editor.noDue')}</option>
                <option value="after">{t('schedules.editor.dueAfter')}</option>
              </Select>
            </Field>
            {fields.due_after_days != null && (
              <Field label={t('schedules.editor.dueDays')}>
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={fields.due_after_days}
                  onChange={(e) =>
                    set({ due_after_days: Math.max(0, Number(e.target.value) || 0) })
                  }
                  className="field w-full"
                />
              </Field>
            )}
          </div>

          {labels.length > 0 && (
            <div className="mt-3">
              <span className="mb-1 block text-xs font-medium text-neutral-500">
                {t('schedules.editor.labels')}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {labels.map((label) => {
                  const active = labelIds.includes(label.id)
                  return (
                    <button
                      key={label.id}
                      type="button"
                      onClick={() => toggleLabel(label.id)}
                      data-active={active}
                      aria-pressed={active}
                      className="chip chip-toggle"
                      style={{ ['--chip' as string]: label.color }}
                    >
                      {label.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </details>

        <fieldset className="mt-4 space-y-2">
          <legend className="sr-only">{t('schedules.editor.when')}</legend>
          <label className="flex items-center gap-2.5 text-sm text-neutral-700">
            <input
              type="radio"
              name="when"
              checked={!fields.wait_for_previous}
              onChange={() => set({ wait_for_previous: false })}
              className="h-4 w-4 accent-[var(--color-brand-600)]"
            />
            {t('schedules.editor.onSchedule')}
          </label>
          <label className="flex items-center gap-2.5 text-sm text-neutral-700">
            <input
              type="radio"
              name="when"
              checked={Boolean(fields.wait_for_previous)}
              onChange={() => set({ wait_for_previous: true })}
              className="h-4 w-4 accent-[var(--color-brand-600)]"
            />
            {t('schedules.editor.waitForPrevious')}
          </label>
        </fieldset>

        <p className="well mt-4 rounded-control px-3 py-2 text-xs text-neutral-600">
          {i18n.t('settings:schedules.line', {
            when: describeRepeat(fields),
            what: describeWhat(
              fields,
              members.find((member) => member.user.id === fields.assignee_id)?.user.full_name ??
                null,
            ),
          })}
          {recent.length > 0 && (
            <>
              {' '}
              {madeSentence(recent, schedule?.created_count ?? 0)}
            </>
          )}
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            {t('common:cancel')}
          </button>
          <button
            type="submit"
            disabled={saving || (fields.frequency === 'weekly' && weekdays.length === 0)}
            className="btn btn-primary btn-sm"
          >
            {saving
              ? t('common:saving')
              : schedule
                ? t('schedules.editor.save')
                : t('schedules.editor.add')}
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

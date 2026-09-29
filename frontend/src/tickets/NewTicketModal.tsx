import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'

import { errorDetail } from '@/api/errors'
import { useCreateTicketTeamsTeamIdTicketsPost } from '@/api/generated/endpoints/tickets/tickets'
import { useListTemplatesTeamsTeamIdTicketTemplatesGet } from '@/api/generated/endpoints/templates/templates'
import { TicketPriority, type TicketType } from '@/api/generated/models'
import { Trans, userText, useTranslation } from '@/i18n'
import { formatList } from '@/i18n/format'
import { CustomFieldControl } from '@/tickets/CustomFieldControl'
import {
  type FieldInput,
  editableFields,
  isFilled,
  missingRequired,
  useCustomFields,
} from '@/tickets/customFields'
import {
  ESTIMATE_SCALE,
  PRIORITY_META,
  PRIORITY_ORDER,
  TYPE_META,
  TYPE_ORDER,
} from '@/tickets/ticketMeta'
import { replacingLosesWork } from '@/tickets/templates'
import { MarkdownEditor } from '@/markdown/lazy'
import { activeMembers } from '@/team/members'
import { invalidateProjects, pickableProjects } from '@/team/projects'
import { useTeamContext } from '@/team/useTeamContext'
import { Icon } from '@/ui/Icon'
import { Select } from '@/ui/Select'
import { useFocusTrap } from '@/ui/useFocusTrap'

export function NewTicketModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['tickets', 'common'])
  const dialogRef = useFocusTrap<HTMLDivElement>()
  const titleId = useId()
  const { team, projects, labels, members, sprints, statuses } = useTeamContext()
  const queryClient = useQueryClient()
  const createTicket = useCreateTicketTeamsTeamIdTicketsPost()
  const templates = useListTemplatesTeamsTeamIdTicketTemplatesGet(team.id).data ?? []
  const customFields = useCustomFields(team.id)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  // The template in use, and the text it put there -- which is how choosing
  // another one knows whether anything typed since would be lost (#97).
  const [templateId, setTemplateId] = useState('')
  const [appliedBody, setAppliedBody] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string>('')
  // Empty means "whatever the team's leftmost column is", which the API
  // decides. Seeding from `statuses[0]` here would race the query that
  // loads them.
  const [statusId, setStatusId] = useState<string>('')
  const [priority, setPriority] = useState<TicketPriority>(TicketPriority.no_priority)
  const [type, setType] = useState<TicketType>('task')
  const [estimate, setEstimate] = useState<(typeof ESTIMATE_SCALE)[number] | null>(null)
  const [sprintId, setSprintId] = useState<string>('')
  const [dueDate, setDueDate] = useState('')
  const [assigneeId, setAssigneeId] = useState<string>('')
  const [labelIds, setLabelIds] = useState<number[]>([])
  // The team's own fields (#117), by key. Only the ones a ticket of the
  // chosen type has are offered, and only those are sent.
  const [fieldValues, setFieldValues] = useState<Record<string, FieldInput>>({})
  // Set by a submit that left a required field empty, and from then on
  // recomputed as the form changes, so filling one in clears its warning.
  const [checkRequired, setCheckRequired] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const formFields = editableFields(customFields, type)
  const missing = checkRequired ? missingRequired(customFields, type, fieldValues) : []

  const applyTemplate = (id: string) => {
    const template = templates.find((candidate) => String(candidate.id) === id)
    if (!template) {
      setTemplateId('')
      return
    }
    // A prefill, not a lock: it only ever writes the description, and asks
    // first when that would replace something the user wrote themselves.
    if (
      replacingLosesWork(description, appliedBody) &&
      !window.confirm(t('newTicket.replaceDescription', { name: template.name }))
    ) {
      return
    }
    setTemplateId(id)
    setDescription(template.body)
    setAppliedBody(template.body)
  }

  const toggleLabel = (id: number) => {
    setLabelIds((prev) => (prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]))
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    setError(null)
    // The check the API makes, made first: the form can point at the field.
    if (missingRequired(customFields, type, fieldValues).length > 0) {
      setCheckRequired(true)
      return
    }
    // Only the fields this type of ticket has: a value chosen before the type
    // was changed is not sent for a field the ticket no longer takes.
    const filled = formFields
      .filter((field) => isFilled(fieldValues[field.key]))
      .map((field) => [field.key, fieldValues[field.key]] as const)
    try {
      await createTicket.mutateAsync({
        teamId: team.id,
        data: {
          title: title.trim(),
          description: description.trim() || undefined,
          project_id: projectId ? Number(projectId) : undefined,
          status_id: statusId ? Number(statusId) : undefined,
          priority,
          type,
          estimate,
          sprint_id: sprintId ? Number(sprintId) : undefined,
          due_date: dueDate || undefined,
          assignee_id: assigneeId ? Number(assigneeId) : undefined,
          label_ids: labelIds,
          custom_fields: filled.length > 0 ? Object.fromEntries(filled) : undefined,
        },
      })
      queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/tickets`] })
      invalidateProjects(queryClient, team.id)
      onClose()
    } catch (err: unknown) {
      // The API's sentence when it has one -- a field made required since
      // the form loaded is named in it.
      setError(errorDetail(err, t('newTicket.errors.create')))
    }
  }

  return (
    <div
      className="scrim fixed inset-0 z-20 flex items-start justify-center px-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="pop-in glass-strong w-full max-w-xl rounded-panel"
      >
        <form onSubmit={onSubmit}>
          <h2 id={titleId} className="sr-only">
            {t('newTicket.title')}
          </h2>
          <div className="hairline border-b px-5 pb-4 pt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="identifier rounded-full bg-neutral-900/6 px-2 py-0.5 text-[11px] font-semibold text-neutral-500">
                  {team.key}
                </span>
                {/* Only on teams that wrote some: an empty picker is a
                    question with no answers. */}
                {templates.length > 0 && (
                  <Select
                    dense
                    value={templateId}
                    onChange={(e) => applyTemplate(e.target.value)}
                    aria-label={t('newTicket.template')}
                  >
                    <option value="">{t('newTicket.noTemplate')}</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </Select>
                )}
              </span>
              <button
                type="button"
                onClick={onClose}
                className="btn btn-ghost btn-icon btn-xs text-neutral-400"
                aria-label={t('common:close')}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            <input
              autoFocus
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('newTicket.ticketTitle')}
              aria-label={t('newTicket.ticketTitle')}
              className="w-full border-none bg-transparent p-0 text-lg font-semibold tracking-tight text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-0"
            />
            <MarkdownEditor
              value={description}
              onChange={setDescription}
              people={activeMembers(members)}
              placeholder={t('newTicket.descriptionPlaceholder')}
              rows={4}
              className="mt-3"
            />
          </div>

          {error && (
            <div role="alert" className="px-5 pt-3 text-sm text-danger-600">
              {error}
            </div>
          )}

          <div className="flex flex-wrap gap-2 px-5 py-3">
            <Select
              dense
              value={statusId}
              onChange={(e) => setStatusId(e.target.value)}
              aria-label={t('newTicket.status')}
            >
              {statuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name}
                </option>
              ))}
            </Select>

            <Select
              dense
              value={type}
              onChange={(e) => setType(e.target.value as TicketType)}
              aria-label={t('newTicket.type')}
            >
              {TYPE_ORDER.map((value) => (
                <option key={value} value={value}>
                  {TYPE_META[value].label}
                </option>
              ))}
            </Select>

            <Select
              dense
              value={priority}
              onChange={(e) => setPriority(e.target.value as TicketPriority)}
              aria-label={t('newTicket.priority')}
            >
              {PRIORITY_ORDER.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_META[p].label}
                </option>
              ))}
            </Select>

            <Select
              dense
              value={estimate ?? ''}
              onChange={(e) =>
                setEstimate(ESTIMATE_SCALE.find((p) => String(p) === e.target.value) ?? null)
              }
              aria-label={t('newTicket.estimate')}
            >
              <option value="">{t('newTicket.noEstimate')}</option>
              {ESTIMATE_SCALE.map((points) => (
                <option key={points} value={points}>
                  {t('card.points', { count: points })}
                </option>
              ))}
            </Select>

            <Select
              dense
              value={sprintId}
              onChange={(e) => setSprintId(e.target.value)}
              aria-label={t('newTicket.sprint')}
            >
              <option value="">{t('newTicket.noSprint')}</option>
              {sprints
                .filter((c) => c.state !== 'completed')
                .map((sprint) => (
                  <option key={sprint.id} value={sprint.id}>
                    {sprint.display_name}
                  </option>
                ))}
            </Select>

            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              aria-label={t('newTicket.dueDate')}
              title={t('newTicket.dueDate')}
              className="field field-sm w-auto"
            />

            <Select
              dense
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              aria-label={t('newTicket.project')}
            >
              <option value="">{t('newTicket.noProject')}</option>
              {pickableProjects(projects).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>

            <Select
              dense
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              aria-label={t('newTicket.assignee')}
            >
              <option value="">{t('newTicket.unassigned')}</option>
              {activeMembers(members).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name}
                </option>
              ))}
            </Select>
          </div>

          {labels.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-5 pb-4">
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
          )}

          {formFields.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
              <span className="eyebrow mr-1">
                {t('customFields.heading', { team: team.name })}
              </span>
              {formFields.map((field) => (
                <CustomFieldControl
                  key={field.id}
                  field={field}
                  value={fieldValues[field.key] ?? undefined}
                  live
                  label={field.name}
                  placeholder={field.required ? `${field.name} *` : field.name}
                  invalid={missing.some((gap) => gap.id === field.id)}
                  onChange={(value) =>
                    setFieldValues((prev) => ({ ...prev, [field.key]: value }))
                  }
                />
              ))}
            </div>
          )}

          {missing.length > 0 && (
            <div
              role="alert"
              className="mx-5 mb-4 flex items-start gap-2.5 rounded-control border border-danger-500/30 bg-danger-50 px-3.5 py-3 text-sm text-neutral-700"
            >
              <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-danger-600" />
              <span>
                <Trans
                  t={t}
                  i18nKey="customFields.required"
                  count={missing.length}
                  values={{
                    fields: formatList(missing.map((field) => field.name)),
                    team: team.name,
                  }}
                  components={{ strong: <strong className="font-semibold text-neutral-900" /> }}
                  {...userText}
                />
              </span>
            </div>
          )}

          <div className="hairline flex items-center justify-end gap-2 border-t px-5 py-3">
            <button type="button" onClick={onClose} className="btn btn-ghost">
              {t('common:cancel')}
            </button>
            <button
              type="submit"
              disabled={createTicket.isPending || !title.trim()}
              className="btn btn-primary"
            >
              {createTicket.isPending ? t('newTicket.creating') : t('newTicket.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

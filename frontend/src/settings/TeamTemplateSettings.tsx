import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useParams } from 'react-router-dom'

import {
  getListTemplatesTeamsTeamIdIssueTemplatesGetQueryKey,
  useCreateTemplateTeamsTeamIdIssueTemplatesPost,
  useDeleteTemplateIssueTemplatesTemplateIdDelete,
  useListTemplatesTeamsTeamIdIssueTemplatesGet,
  useReorderTemplatesTeamsTeamIdIssueTemplatesOrderPut,
  useUpdateTemplateIssueTemplatesTemplateIdPatch,
} from '@/api/generated/endpoints/templates/templates'
import { useListTeamMembersTeamsTeamIdMembersGet } from '@/api/generated/endpoints/teams/teams'
import type { IssueTemplateRead, TeamRead } from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/useAuth'
import { useTeamByKey } from '@/team/useTeams'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'

/**
 * A team's issue description templates (#97).
 *
 * The new-issue form offers these as a starting point for the description.
 * Admins write them; everyone else sees what the form will offer.
 */
export default function TeamTemplateSettings() {
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
  return <TemplateList key={team.id} team={team} isAdmin={isAdmin} />
}

function TemplateList({ team, isAdmin }: { team: TeamRead; isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const query = useListTemplatesTeamsTeamIdIssueTemplatesGet(team.id)
  const create = useCreateTemplateTeamsTeamIdIssueTemplatesPost()
  const update = useUpdateTemplateIssueTemplatesTemplateIdPatch()
  const reorder = useReorderTemplatesTeamsTeamIdIssueTemplatesOrderPut()
  const remove = useDeleteTemplateIssueTemplatesTemplateIdDelete()

  const [error, setError] = useState<string | null>(null)
  // null: nothing open; 'new': the add form; a number: that template's editor.
  const [editing, setEditing] = useState<number | 'new' | null>(null)

  const templates = query.data ?? []

  /** True when it worked, so a form knows whether to close. */
  const run = async (work: () => Promise<unknown>, fallback: string) => {
    setError(null)
    try {
      await work()
      await queryClient.invalidateQueries({
        queryKey: getListTemplatesTeamsTeamIdIssueTemplatesGetQueryKey(team.id),
      })
      return true
    } catch (err: unknown) {
      setError(errorDetail(err, fallback))
      return false
    }
  }

  const move = (index: number, delta: number) => {
    const next = [...templates]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    return run(
      () =>
        reorder.mutateAsync({
          teamId: team.id,
          data: { template_ids: next.map((template) => template.id) },
        }),
      'Could not reorder the templates.',
    )
  }

  const onDelete = (template: IssueTemplateRead) => {
    if (!window.confirm(`Delete the “${template.name}” template? Issues filed from it keep their text.`)) {
      return
    }
    return run(
      () => remove.mutateAsync({ templateId: template.id }),
      'Could not delete that template.',
    )
  }

  if (query.isLoading) return <Loading />

  return (
    <div className="glass-strong sheen rounded-panel p-6">
      <h1 className="text-lg font-semibold tracking-tight text-neutral-900">Issue templates</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Starting points for a new issue’s description on {team.name}. Choosing one in the
        new-issue form fills the description, and it can be edited freely from there.
      </p>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
        >
          {error}
        </div>
      )}

      {templates.length === 0 && editing !== 'new' && (
        <p className="well mt-5 rounded-control px-3 py-3 text-sm text-neutral-500">
          {isAdmin
            ? 'No templates yet. A bug report with repro steps is the usual first one.'
            : 'This team has no templates.'}
        </p>
      )}

      <ul className="mt-5 space-y-1.5">
        {templates.map((template, index) =>
          editing === template.id ? (
            <li key={template.id}>
              <TemplateForm
                initial={template}
                submitLabel="Save"
                onCancel={() => setEditing(null)}
                onSubmit={async (data) => {
                  const ok = await run(
                    () => update.mutateAsync({ templateId: template.id, data }),
                    'Could not save that template.',
                  )
                  if (ok) setEditing(null)
                }}
              />
            </li>
          ) : (
            <li key={template.id} className="well flex items-center gap-3 rounded-control px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-900">{template.name}</p>
                <p className="identifier truncate text-xs text-neutral-400">
                  {firstLine(template.body)}
                </p>
              </div>
              {isAdmin && (
                <span className="flex shrink-0 items-center">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${template.name} up`}
                    className="btn btn-ghost btn-icon btn-xs text-neutral-400 disabled:opacity-30"
                  >
                    <Icon name="chevron-up" size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === templates.length - 1}
                    aria-label={`Move ${template.name} down`}
                    className="btn btn-ghost btn-icon btn-xs text-neutral-400 disabled:opacity-30"
                  >
                    <Icon name="chevron-down" size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(template.id)}
                    className="btn btn-ghost btn-xs"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(template)}
                    aria-label={`Delete ${template.name}`}
                    className="btn btn-ghost btn-icon btn-xs text-neutral-400 hover:text-danger-600"
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </span>
              )}
            </li>
          ),
        )}
      </ul>

      {isAdmin &&
        (editing === 'new' ? (
          <div className="mt-3">
            <TemplateForm
              submitLabel="Add template"
              onCancel={() => setEditing(null)}
              onSubmit={async (data) => {
                const ok = await run(
                  () => create.mutateAsync({ teamId: team.id, data }),
                  'Could not add that template.',
                )
                if (ok) setEditing(null)
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="btn btn-secondary btn-sm mt-3"
          >
            <Icon name="plus" size={13} />
            Add a template
          </button>
        ))}

      {!isAdmin && (
        <p className="mt-4 text-xs text-neutral-400">Only team admins can change the templates.</p>
      )}
    </div>
  )
}

function TemplateForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: IssueTemplateRead
  submitLabel: string
  onSubmit: (data: { name: string; body: string }) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim() || !body.trim()) return
    setSaving(true)
    try {
      await onSubmit({ name: name.trim(), body })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="well space-y-3 rounded-card p-3">
      <label className="block">
        <span className="eyebrow mb-1 block">Name</span>
        <input
          autoFocus
          required
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Bug report"
          className="field field-sm"
        />
      </label>
      <label className="block">
        <span className="eyebrow mb-1 block">Description (Markdown)</span>
        <textarea
          required
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={'## Steps to reproduce\n\n1. \n\n## Expected\n\n## Actual'}
          className="field field-sm identifier"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn btn-secondary btn-sm">
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}

/** A one-line preview: the first line with anything in it, minus heading marks. */
function firstLine(body: string): string {
  const line = body.split('\n').find((candidate) => candidate.trim()) ?? ''
  return line.replace(/^#+\s*/, '').trim()
}

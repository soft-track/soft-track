import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'

import { useCreateIssueTeamsTeamIdIssuesPost } from '../api/generated/endpoints/issues/issues'
import { IssuePriority, IssueStatus } from '../api/generated/models'
import {
  ESTIMATE_SCALE,
  PRIORITY_META,
  PRIORITY_ORDER,
  STATUS_META,
  STATUS_ORDER,
} from '../lib/issueMeta'
import { MarkdownEditor } from '../markdown/lazy'
import { useTeamContext } from '../team/TeamContext'

export function NewIssueModal({ onClose }: { onClose: () => void }) {
  const { team, projects, labels, members, cycles } = useTeamContext()
  const queryClient = useQueryClient()
  const createIssue = useCreateIssueTeamsTeamIdIssuesPost()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [projectId, setProjectId] = useState<string>('')
  const [status, setStatus] = useState<IssueStatus>(IssueStatus.backlog)
  const [priority, setPriority] = useState<IssuePriority>(IssuePriority.no_priority)
  const [estimate, setEstimate] = useState<(typeof ESTIMATE_SCALE)[number] | null>(null)
  const [cycleId, setCycleId] = useState<string>('')
  const [assigneeId, setAssigneeId] = useState<string>('')
  const [labelIds, setLabelIds] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)

  const toggleLabel = (id: number) => {
    setLabelIds((prev) => (prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]))
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    setError(null)
    try {
      await createIssue.mutateAsync({
        teamId: team.id,
        data: {
          title: title.trim(),
          description: description.trim() || undefined,
          project_id: projectId ? Number(projectId) : undefined,
          status,
          priority,
          estimate,
          cycle_id: cycleId ? Number(cycleId) : undefined,
          assignee_id: assigneeId ? Number(assigneeId) : undefined,
          label_ids: labelIds,
        },
      })
      queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/issues`] })
      onClose()
    } catch {
      setError('Could not create the issue. Please try again.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-start justify-center bg-black/30 pt-24"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-neutral-200 bg-white shadow-xl"
      >
        <form onSubmit={onSubmit}>
          <div className="border-b border-neutral-100 px-4 py-3">
            <p className="text-xs font-medium text-neutral-400">{team.key}</p>
            <input
              autoFocus
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Issue title"
              className="w-full border-none p-0 text-base font-medium text-neutral-900 placeholder-neutral-300 focus:outline-none focus:ring-0"
            />
            <MarkdownEditor
              value={description}
              onChange={setDescription}
              people={members.map((m) => m.user)}
              placeholder="Add a description… Markdown works here."
              rows={4}
              className="mt-2"
            />
          </div>

          {error && <div className="px-4 pt-2 text-sm text-danger-600">{error}</div>}

          <div className="flex flex-wrap gap-2 px-4 py-3">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as IssueStatus)}
              className="rounded-md border border-neutral-200 px-2 py-1 text-xs"
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>

            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as IssuePriority)}
              className="rounded-md border border-neutral-200 px-2 py-1 text-xs"
            >
              {PRIORITY_ORDER.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_META[p].label}
                </option>
              ))}
            </select>

            <select
              value={estimate ?? ''}
              onChange={(e) =>
                setEstimate(ESTIMATE_SCALE.find((p) => String(p) === e.target.value) ?? null)
              }
              className="rounded-md border border-neutral-200 px-2 py-1 text-xs"
            >
              <option value="">No estimate</option>
              {ESTIMATE_SCALE.map((points) => (
                <option key={points} value={points}>
                  {points} {points === 1 ? 'point' : 'points'}
                </option>
              ))}
            </select>

            <select
              value={cycleId}
              onChange={(e) => setCycleId(e.target.value)}
              className="rounded-md border border-neutral-200 px-2 py-1 text-xs"
            >
              <option value="">Backlog</option>
              {cycles
                .filter((c) => c.state !== 'completed')
                .map((cycle) => (
                  <option key={cycle.id} value={cycle.id}>
                    {cycle.display_name}
                  </option>
                ))}
            </select>

            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="rounded-md border border-neutral-200 px-2 py-1 text-xs"
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="rounded-md border border-neutral-200 px-2 py-1 text-xs"
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {m.user.full_name}
                </option>
              ))}
            </select>
          </div>

          {labels.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-3">
              {labels.map((label) => {
                const active = labelIds.includes(label.id)
                return (
                  <button
                    key={label.id}
                    type="button"
                    onClick={() => toggleLabel(label.id)}
                    className="rounded-full border px-2 py-0.5 text-[11px] font-medium transition"
                    style={{
                      borderColor: active ? label.color : '#e5e7eb',
                      backgroundColor: active ? `${label.color}20` : 'transparent',
                      color: active ? label.color : '#6b7280',
                    }}
                  >
                    {label.name}
                  </button>
                )
              })}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-neutral-100 px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createIssue.isPending || !title.trim()}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {createIssue.isPending ? 'Creating…' : 'Create issue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

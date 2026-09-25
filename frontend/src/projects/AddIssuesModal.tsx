import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'

import { errorDetail } from '@/api/errors'
import { useBulkUpdateIssuesTeamsTeamIdIssuesBulkUpdatePost } from '@/api/generated/endpoints/issues/issues'
import { useSearchSearchGet } from '@/api/generated/endpoints/search/search'
import type { ProjectRead } from '@/api/generated/models'
import { useDebounced } from '@/search/useDebounced'
import { invalidateProjects } from '@/team/projects'
import { useTeamContext } from '@/team/useTeamContext'
import { Icon } from '@/ui/Icon'

/**
 * Filing existing issues into a project.
 *
 * Found by search rather than picked from a list: a team has far more issues
 * than a dropdown can hold, and the one somebody wants is the one they can
 * name. Everything ticked goes in with one bulk edit, so it gets the same
 * history and automation runs as moving them from the board.
 */
export function AddIssuesModal({
  project,
  alreadyIn,
  onClose,
}: {
  project: ProjectRead
  /** Issues already in the project, shown as such rather than offered again. */
  alreadyIn: ReadonlySet<number>
  onClose: () => void
}) {
  const { team } = useTeamContext()
  const queryClient = useQueryClient()
  const bulkUpdate = useBulkUpdateIssuesTeamsTeamIdIssuesBulkUpdatePost()

  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const settled = useDebounced(query.trim(), 250)
  const results = useSearchSearchGet(
    { q: settled || 'x', team_id: team.id, limit: 20 },
    { query: { enabled: settled.length > 0 } },
  )
  const hits = settled ? (results.data?.items ?? []) : []

  const toggle = (id: number) =>
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (picked.size === 0) return
    setError(null)
    try {
      await bulkUpdate.mutateAsync({
        teamId: team.id,
        data: { issue_ids: [...picked], changes: { project_id: project.id } },
      })
      queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/issues`] })
      invalidateProjects(queryClient, team.id)
      onClose()
    } catch (err: unknown) {
      setError(errorDetail(err, 'Could not add those issues.'))
    }
  }

  return (
    <div
      className="scrim fixed inset-0 z-30 flex items-start justify-center px-4 pt-[12vh]"
      onClick={onClose}
    >
      <form
        role="dialog"
        aria-label={`Add issues to ${project.name}`}
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="pop-in glass-strong flex max-h-[70vh] w-full max-w-lg flex-col rounded-panel p-5"
      >
        <h2 className="text-base font-semibold tracking-tight text-neutral-900">
          Add issues to {project.name}
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          An issue belongs to one project at a time, so adding one that is already
          in another project moves it here.
        </p>

        {error && (
          <div
            role="alert"
            className="mt-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </div>
        )}

        <label className="relative mt-4 block">
          <span className="sr-only">Search issues</span>
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
          />
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search issues on this team…"
            className="field pl-8"
          />
        </label>

        <ul className="scroll-thin -mx-1 mt-3 min-h-24 flex-1 overflow-y-auto px-1">
          {!settled && (
            <li className="py-6 text-center text-sm text-neutral-400">
              Search by title, description or comment.
            </li>
          )}
          {settled && results.isLoading && (
            <li className="py-6 text-center text-sm text-neutral-400">Searching…</li>
          )}
          {settled && !results.isLoading && hits.length === 0 && (
            <li className="py-6 text-center text-sm text-neutral-400">No issues match.</li>
          )}
          {hits.map((hit) => {
            const inside = alreadyIn.has(hit.id)
            return (
              <li key={hit.id}>
                <label
                  className={`flex items-center gap-2.5 rounded-control px-2 py-1.5 text-sm ${
                    inside ? 'text-neutral-400' : 'cursor-pointer hover:bg-neutral-900/4'
                  }`}
                >
                  <input
                    type="checkbox"
                    disabled={inside}
                    checked={inside || picked.has(hit.id)}
                    onChange={() => toggle(hit.id)}
                    className="h-4 w-4 shrink-0 accent-[var(--color-brand-600)]"
                  />
                  <span className="identifier w-16 shrink-0 text-xs text-neutral-400">
                    {hit.identifier}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{hit.title}</span>
                  {inside && <span className="shrink-0 text-xs">Already here</span>}
                </label>
              </li>
            )
          })}
        </ul>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
            Cancel
          </button>
          <button
            type="submit"
            disabled={picked.size === 0 || bulkUpdate.isPending}
            className="btn btn-primary btn-sm"
          >
            {picked.size === 0
              ? 'Add issues'
              : `Add ${picked.size} ${picked.size === 1 ? 'issue' : 'issues'}`}
          </button>
        </div>
      </form>
    </div>
  )
}

import { type FormEvent, useState } from 'react'

import type { SavedViewRead } from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { summarise } from '@/board/filterLabels'
import type { BoardFilters } from '@/board/filters'
import { toViewFilters } from '@/board/filters'
import { useTeamContext } from '@/team/TeamContext'
import { useSavedViews } from '@/views/useSavedViews'

/**
 * Naming a set of filters, or renaming one that already has a name.
 *
 * The same form for both: `editing` decides whether submitting creates a view
 * or updates one, and the filters come from the board either way -- so
 * "update this view to what I am looking at now" needs no separate gesture.
 */
export function SaveViewModal({
  filters,
  editing,
  onClose,
}: {
  filters: BoardFilters
  editing?: SavedViewRead
  onClose: () => void
}) {
  const { team, members, labels, projects, cycles, statuses } = useTeamContext()
  const views = useSavedViews(team.id)

  const [name, setName] = useState(editing?.name ?? '')
  const [isShared, setIsShared] = useState(editing?.is_shared ?? false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      if (editing) {
        await views.edit(editing, {
          name: name.trim(),
          is_shared: isShared,
          filters: toViewFilters(filters),
        })
      } else {
        await views.save(name.trim(), toViewFilters(filters), isShared)
      }
      onClose()
    } catch (err: unknown) {
      setError(errorDetail(err, 'Could not save that view.'))
    }
  }

  return (
    <div
      className="scrim fixed inset-0 z-30 flex items-start justify-center px-4 pt-[15vh]"
      onClick={onClose}
    >
      <form
        role="dialog"
        aria-label={editing ? 'Edit view' : 'Save view'}
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="pop-in glass-strong w-full max-w-sm rounded-panel p-5"
      >
        <h2 className="text-base font-semibold tracking-tight text-neutral-900">
          {editing ? 'Edit view' : 'Save this view'}
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          {summarise(filters, { members, labels, projects, cycles, statuses })}
        </p>

        {error && (
          <div
            role="alert"
            className="mt-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </div>
        )}

        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">Name</span>
          <input
            autoFocus
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Urgent bugs"
            className="field"
          />
        </label>

        <label className="mt-4 flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={isShared}
            onChange={(e) => setIsShared(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand-600)]"
          />
          <span>
            <span className="block text-sm font-medium text-neutral-700">
              Share with the team
            </span>
            <span className="mt-0.5 block text-xs text-neutral-500">
              Everyone on {team.name} sees it in their sidebar. Private otherwise — a
              link to these filters still works for anyone on the team.
            </span>
          </span>
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
            Cancel
          </button>
          <button type="submit" disabled={!name.trim()} className="btn btn-primary btn-sm">
            {editing ? 'Save changes' : 'Save view'}
          </button>
        </div>
      </form>
    </div>
  )
}

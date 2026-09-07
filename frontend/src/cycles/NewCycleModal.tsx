import { useQueryClient } from '@tanstack/react-query'
import { addDays, format } from 'date-fns'
import { type FormEvent, useState } from 'react'

import { useCreateCycleTeamsTeamIdCyclesPost } from '@/api/generated/endpoints/cycles/cycles'
import { useTeamContext } from '@/team/TeamContext'

/** A day, as the value an <input type="date"> wants. */
const asDateInput = (date: Date) => format(date, 'yyyy-MM-dd')

export function NewCycleModal({ onClose }: { onClose: () => void }) {
  const { team } = useTeamContext()
  const queryClient = useQueryClient()
  const createCycle = useCreateCycleTeamsTeamIdCyclesPost()

  const [name, setName] = useState('')
  // A fortnight from today: the common case, and still editable.
  const [startsAt, setStartsAt] = useState(asDateInput(new Date()))
  const [endsAt, setEndsAt] = useState(asDateInput(addDays(new Date(), 14)))
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      await createCycle.mutateAsync({
        teamId: team.id,
        data: {
          name: name.trim() || undefined,
          starts_at: new Date(`${startsAt}T00:00:00Z`).toISOString(),
          ends_at: new Date(`${endsAt}T23:59:59Z`).toISOString(),
        },
      })
      queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/cycles`] })
      onClose()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data
        ?.detail
      setError(typeof detail === 'string' ? detail : 'Could not create that cycle.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center bg-black/20 pt-[15vh]"
      onClick={onClose}
    >
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-4 shadow-2xl"
      >
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">New cycle</h2>

        <label className="mb-2 block">
          <span className="mb-1 block text-xs text-neutral-500">Name (optional)</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Left blank, it will be numbered"
            className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
          />
        </label>

        <div className="mb-3 flex gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-xs text-neutral-500">Starts</span>
            <input
              type="date"
              required
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
            />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-xs text-neutral-500">Ends</span>
            <input
              type="date"
              required
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
            />
          </label>
        </div>

        {error && <p className="mb-2 text-xs text-danger-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2.5 py-1.5 text-sm text-neutral-500 hover:text-neutral-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={createCycle.isPending}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  )
}

import { useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow, isPast } from 'date-fns'
import { useState } from 'react'

import {
  useCompleteCycleCyclesCycleIdCompletePost,
  useStartCycleCyclesCycleIdStartPost,
} from '../api/generated/endpoints/cycles/cycles'
import type { CycleRead } from '../api/generated/models'
import { useTeamContext } from '../team/TeamContext'

/** Shown above the board while a cycle is selected. */
export function CycleBanner({ cycle }: { cycle: CycleRead }) {
  const { team } = useTeamContext()
  const queryClient = useQueryClient()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const startCycle = useStartCycleCyclesCycleIdStartPost()
  const completeCycle = useCompleteCycleCyclesCycleIdCompletePost()

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/cycles`] })
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/issues`] })
  }

  const run = async (action: () => Promise<unknown>, describe: (r: never) => string) => {
    setError(null)
    setMessage(null)
    try {
      const result = await action()
      setMessage(describe(result as never))
      refresh()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail
      setError(typeof detail === 'string' ? detail : 'That did not work.')
    }
  }

  const { progress } = cycle
  const ends = new Date(cycle.ends_at)
  const overdue = cycle.state === 'active' && isPast(ends)

  return (
    <div className="border-b border-neutral-200 bg-white px-4 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-neutral-900">{cycle.display_name}</span>
        <span className="text-xs text-neutral-400">
          {format(new Date(cycle.starts_at), 'd MMM')} – {format(ends, 'd MMM')}
          {cycle.state !== 'completed' && (
            <span className={overdue ? 'text-danger-600' : undefined}>
              {' · '}
              {overdue ? 'ended ' : 'ends '}
              {formatDistanceToNow(ends, { addSuffix: true })}
            </span>
          )}
        </span>

        <span className="text-xs text-neutral-500">
          {progress.issues_completed}/{progress.issues_total} issues ·{' '}
          {progress.points_completed}/{progress.points_total} pts
          {progress.issues_unestimated > 0 && (
            <span
              className="text-neutral-400"
              title="Points totals are only as honest as this number is small"
            >
              {' '}
              ({progress.issues_unestimated} unsized)
            </span>
          )}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {cycle.state === 'upcoming' && (
            <button
              type="button"
              disabled={startCycle.isPending}
              onClick={() =>
                run(
                  () => startCycle.mutateAsync({ cycleId: cycle.id }),
                  () => 'Cycle started.',
                )
              }
              className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              Start cycle
            </button>
          )}
          {cycle.state === 'active' && (
            <button
              type="button"
              disabled={completeCycle.isPending}
              onClick={() =>
                run(
                  () => completeCycle.mutateAsync({ cycleId: cycle.id }),
                  (result: { carried_over: number; carried_into_cycle_id: number | null }) =>
                    result.carried_over === 0
                      ? 'Cycle completed with everything finished.'
                      : `Cycle completed. ${result.carried_over} unfinished ${
                          result.carried_over === 1 ? 'issue' : 'issues'
                        } moved to ${
                          result.carried_into_cycle_id ? 'the next cycle' : 'the backlog'
                        }.`,
                )
              }
              className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              Complete cycle
            </button>
          )}
          {cycle.state === 'completed' && (
            <span className="text-xs text-neutral-400">Completed</span>
          )}
        </div>
      </div>

      {/* Say what happened to the carried-over work rather than leaving people
          to wonder where their issues went. */}
      {message && <p className="mt-1 text-xs text-brand-700">{message}</p>}
      {error && <p className="mt-1 text-xs text-danger-600">{error}</p>}
    </div>
  )
}

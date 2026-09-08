import { useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, isPast } from 'date-fns'
import { useState } from 'react'

import { formatCycleRange, parseServerDate } from '@/api/dates'

import {
  useCompleteCycleCyclesCycleIdCompletePost,
  useStartCycleCyclesCycleIdStartPost,
} from '@/api/generated/endpoints/cycles/cycles'
import type { CycleRead } from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { useTeamContext } from '@/team/TeamContext'
import { Icon } from '@/ui/Icon'

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
      setError(errorDetail(err, 'That did not work.'))
    }
  }

  const { progress } = cycle
  const ends = parseServerDate(cycle.ends_at)
  const overdue = cycle.state === 'active' && isPast(ends)
  const done = progress.issues_total > 0 ? progress.issues_completed / progress.issues_total : 0
  const cycleRange = formatCycleRange(cycle.starts_at, cycle.ends_at)

  return (
    <div className="glass rounded-panel px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Icon name="calendar" size={15} className="text-neutral-400" />
        <span className="text-sm font-semibold text-neutral-900">{cycle.display_name}</span>
        <span className="text-xs text-neutral-500">
          {cycleRange}
          {cycle.state !== 'completed' && (
            <span className={overdue ? 'text-danger-600' : undefined}>
              {' · '}
              {overdue ? 'ended ' : 'ends '}
              {formatDistanceToNow(ends, { addSuffix: true })}
            </span>
          )}
        </span>

        <span className="flex items-center gap-2 text-xs text-neutral-500">
          <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-neutral-900/8 sm:block">
            <span
              className="block h-full rounded-full bg-linear-to-r from-brand-500 to-accent-sky"
              style={{ width: `${done * 100}%` }}
            />
          </span>
          <span className="identifier">
            {progress.issues_completed}/{progress.issues_total}
          </span>{' '}
          issues ·{' '}
          <span className="identifier">
            {progress.points_completed}/{progress.points_total}
          </span>{' '}
          pts
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
              className="btn btn-primary btn-sm"
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
              className="btn btn-primary btn-sm"
            >
              Complete cycle
            </button>
          )}
          {cycle.state === 'completed' && (
            <span
              className="chip"
              style={{ ['--chip' as string]: 'var(--color-status-done)' }}
            >
              <Icon name="check" size={11} /> Completed
            </span>
          )}
        </div>
      </div>

      {/* Say what happened to the carried-over work rather than leaving people
          to wonder where their issues went. */}
      {message && <p className="mt-1.5 text-xs text-brand-700">{message}</p>}
      {error && <p className="mt-1.5 text-xs text-danger-600">{error}</p>}
    </div>
  )
}

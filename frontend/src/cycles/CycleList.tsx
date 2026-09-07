import { formatDistanceToNow, isPast } from 'date-fns'

import type { CycleRead } from '@/api/generated/models'

/**
 * Cycles in the sidebar.
 *
 * Ordered active, then upcoming, then the last few completed. A team looks at
 * the cycle they are in far more often than the ones they are not, and a list
 * that puts Cycle 1 at the top ages badly.
 */
export function CycleList({
  cycles,
  activeCycleId,
  onSelect,
}: {
  cycles: CycleRead[]
  activeCycleId: number | null
  onSelect: (cycleId: number | null) => void
}) {
  const rank = { active: 0, upcoming: 1, completed: 2 } as const
  const ordered = [...cycles].sort(
    (a, b) => rank[a.state] - rank[b.state] || b.number - a.number,
  )
  const shown = ordered.filter(
    (cycle) => cycle.state !== 'completed' || ordered.indexOf(cycle) < 6,
  )

  if (cycles.length === 0) {
    return <p className="px-2 text-sm text-neutral-400">No cycles yet.</p>
  }

  return (
    <div className="space-y-0.5">
      {shown.map((cycle) => (
        <CycleRow
          key={cycle.id}
          cycle={cycle}
          selected={activeCycleId === cycle.id}
          onSelect={() => onSelect(activeCycleId === cycle.id ? null : cycle.id)}
        />
      ))}
    </div>
  )
}

function CycleRow({
  cycle,
  selected,
  onSelect,
}: {
  cycle: CycleRead
  selected: boolean
  onSelect: () => void
}) {
  const { progress } = cycle
  const done = progress.issues_total > 0 ? progress.issues_completed / progress.issues_total : 0
  const ends = new Date(cycle.ends_at)
  const overdue = cycle.state === 'active' && isPast(ends)

  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-md px-2 py-1.5 text-left ${
        selected ? 'bg-brand-50' : 'hover:bg-neutral-50'
      }`}
    >
      <div className="flex items-baseline gap-1.5">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            cycle.state === 'active'
              ? 'bg-status-in_progress'
              : cycle.state === 'completed'
                ? 'bg-neutral-300'
                : 'bg-neutral-200 ring-1 ring-neutral-300'
          }`}
          title={cycle.state}
        />
        <span
          className={`min-w-0 flex-1 truncate text-sm ${
            selected ? 'font-medium text-brand-700' : 'text-neutral-700'
          } ${cycle.state === 'completed' ? 'text-neutral-400' : ''}`}
        >
          {cycle.display_name}
        </span>
        {progress.issues_total > 0 && (
          <span className="identifier shrink-0 text-[11px] text-neutral-400">
            {progress.issues_completed}/{progress.issues_total}
          </span>
        )}
      </div>

      {cycle.state !== 'completed' && (
        <>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-brand-500 transition-all"
              style={{ width: `${done * 100}%` }}
            />
          </div>
          <p className={`mt-0.5 text-[11px] ${overdue ? 'text-danger-600' : 'text-neutral-400'}`}>
            {/* Points, not just issues -- eight of ten issues done with two of
                thirty points burned means the hard work is still ahead. */}
            {progress.points_total > 0 && (
              <>
                {progress.points_completed}/{progress.points_total} pts ·{' '}
              </>
            )}
            {overdue ? 'ended ' : 'ends '}
            {formatDistanceToNow(ends, { addSuffix: true })}
          </p>
        </>
      )}
    </button>
  )
}

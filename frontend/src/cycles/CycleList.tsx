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
    return <p className="px-2 text-xs text-neutral-400">No cycles yet.</p>
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

const STATE_COLOUR = {
  active: 'var(--color-status-progress)',
  upcoming: 'var(--color-status-todo)',
  completed: 'var(--color-status-done)',
} as const

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
      type="button"
      onClick={onSelect}
      data-active={selected}
      aria-pressed={selected}
      className="nav-item flex-col items-stretch gap-1"
    >
      <span className="flex items-center gap-2">
        <span
          className="dot"
          style={{ ['--dot' as string]: STATE_COLOUR[cycle.state] }}
          title={cycle.state}
        />
        <span
          className={`min-w-0 flex-1 truncate ${
            cycle.state === 'completed' ? 'text-neutral-400' : ''
          }`}
        >
          {cycle.display_name}
        </span>
        {progress.issues_total > 0 && (
          <span className="identifier shrink-0 text-[11px] text-neutral-400">
            {progress.issues_completed}/{progress.issues_total}
          </span>
        )}
      </span>

      {cycle.state !== 'completed' && (
        <>
          <span className="block h-1 overflow-hidden rounded-full bg-neutral-900/8">
            <span
              className="block h-full rounded-full bg-linear-to-r from-brand-500 to-accent-sky transition-all"
              style={{ width: `${done * 100}%` }}
            />
          </span>
          <span
            className={`block text-[11px] font-normal ${
              overdue ? 'text-danger-600' : 'text-neutral-400'
            }`}
          >
            {/* Points, not just issues -- eight of ten issues done with two of
                thirty points burned means the hard work is still ahead. */}
            {progress.points_total > 0 && (
              <>
                {progress.points_completed}/{progress.points_total} pts ·{' '}
              </>
            )}
            {overdue ? 'ended ' : 'ends '}
            {formatDistanceToNow(ends, { addSuffix: true })}
          </span>
        </>
      )}
    </button>
  )
}

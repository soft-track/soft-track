import { isPast } from 'date-fns'
import { parseServerDate } from '@/api/dates'
import type { SprintRead } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { formatRelative } from '@/i18n/format'

/**
 * Sprints in the sidebar.
 *
 * Ordered active, then upcoming, then the last few completed. A team looks at
 * the sprint they are in far more often than the ones they are not, and a list
 * that puts Sprint 1 at the top ages badly.
 */
export function SprintList({
  sprints,
  activeSprintId,
  onSelect,
}: {
  sprints: SprintRead[]
  activeSprintId: number | null
  onSelect: (sprintId: number | null) => void
}) {
  const { t } = useTranslation(['sprints', 'common'])
  const rank = { active: 0, upcoming: 1, completed: 2 } as const
  const ordered = [...sprints].sort(
    (a, b) => rank[a.state] - rank[b.state] || b.number - a.number,
  )
  const shown = ordered.filter(
    (sprint) => sprint.state !== 'completed' || ordered.indexOf(sprint) < 6,
  )

  if (sprints.length === 0) {
    return <p className="px-2 text-xs text-neutral-400">{t('list.empty')}</p>
  }

  return (
    <div className="space-y-0.5">
      {shown.map((sprint) => (
        <SprintRow
          key={sprint.id}
          sprint={sprint}
          selected={activeSprintId === sprint.id}
          onSelect={() => onSelect(activeSprintId === sprint.id ? null : sprint.id)}
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

function SprintRow({
  sprint,
  selected,
  onSelect,
}: {
  sprint: SprintRead
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation(['sprints', 'common'])
  const { progress } = sprint
  const done = progress.issues_total > 0 ? progress.issues_completed / progress.issues_total : 0
  const ends = parseServerDate(sprint.ends_at)
  const overdue = sprint.state === 'active' && isPast(ends)

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
          style={{ ['--dot' as string]: STATE_COLOUR[sprint.state] }}
          title={t(`list.state.${sprint.state}`)}
        />
        <span
          className={`min-w-0 flex-1 truncate ${
            sprint.state === 'completed' ? 'text-neutral-400' : ''
          }`}
        >
          {sprint.display_name}
        </span>
        {progress.issues_total > 0 && (
          <span className="identifier shrink-0 text-[11px] text-neutral-400">
            {progress.issues_completed}/{progress.issues_total}
          </span>
        )}
      </span>

      {sprint.state !== 'completed' && (
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
            {progress.points_total > 0
              ? t(overdue ? 'list.pointsEnded' : 'list.pointsEnds', {
                  completed: progress.points_completed,
                  total: progress.points_total,
                  when: formatRelative(ends),
                })
              : t(overdue ? 'schedule.ended' : 'schedule.ends', { when: formatRelative(ends) })}
          </span>
        </>
      )}
    </button>
  )
}

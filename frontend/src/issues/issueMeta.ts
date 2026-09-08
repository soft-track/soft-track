import { IssuePriority, StatusCategory } from '@/api/generated/models'
import type { IssueUpdateEstimate, StatusRead } from '@/api/generated/models'

/**
 * What each status *category* means, for the few places that have a category
 * and no status row: the cumulative flow diagram, which is drawn from history
 * and therefore knows only categories, and the picker that asks what a new
 * column should mean.
 *
 * Statuses themselves carry their own name and colour now -- they are the
 * team's rows, not a fixed list -- so nothing here describes a column.
 */
export const CATEGORY_ORDER: StatusCategory[] = [
  StatusCategory.backlog,
  StatusCategory.unstarted,
  StatusCategory.started,
  StatusCategory.done,
  StatusCategory.cancelled,
]

export const CATEGORY_META: Record<
  StatusCategory,
  { label: string; hint: string; color: string }
> = {
  backlog: {
    label: 'Backlog',
    hint: 'Not committed to yet',
    color: 'var(--color-status-backlog)',
  },
  unstarted: {
    label: 'Unstarted',
    hint: 'Accepted, not begun',
    color: 'var(--color-status-todo)',
  },
  started: {
    label: 'Started',
    hint: 'Work in flight',
    color: 'var(--color-status-progress)',
  },
  done: { label: 'Done', hint: 'Finished', color: 'var(--color-status-done)' },
  cancelled: {
    label: 'Cancelled',
    hint: 'Closed without being delivered',
    color: 'var(--color-status-cancelled)',
  },
}

/** Work that is finished, one way or the other. Mirrors RESOLVED in lib_softtrack/statuses.py. */
export const RESOLVED_CATEGORIES: StatusCategory[] = [
  StatusCategory.done,
  StatusCategory.cancelled,
]

export function isResolved(status: StatusRead): boolean {
  return RESOLVED_CATEGORIES.includes(status.category)
}

export const PRIORITY_ORDER: IssuePriority[] = [
  IssuePriority.urgent,
  IssuePriority.high,
  IssuePriority.medium,
  IssuePriority.low,
  IssuePriority.no_priority,
]

export const PRIORITY_META: Record<IssuePriority, { label: string; color: string }> = {
  urgent: { label: 'Urgent', color: 'var(--color-priority-urgent)' },
  high: { label: 'High', color: 'var(--color-priority-high)' },
  medium: { label: 'Medium', color: 'var(--color-priority-medium)' },
  low: { label: 'Low', color: 'var(--color-priority-low)' },
  no_priority: { label: 'No priority', color: 'var(--color-priority-none)' },
}

/**
 * The story-point scale, mirroring ESTIMATE_SCALE in
 * backend/lib_softtrack/models/issues.py.
 *
 * The schema declares those five values as an enum, so orval generates a
 * literal union for the field and TypeScript refuses an off-scale estimate at
 * compile time. `satisfies` below is what keeps this list honest against it:
 * if the backend scale changes and the client is regenerated, this line stops
 * compiling instead of silently offering a value the API will reject.
 */
export const ESTIMATE_SCALE = [1, 2, 3, 5, 8] as const satisfies readonly NonNullable<
  IssueUpdateEstimate
>[]

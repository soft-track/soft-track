import { IssuePriority, StatusCategory } from '@/api/generated/models'
import type { IssueType, IssueUpdateEstimate, StatusRead } from '@/api/generated/models'
import { i18n } from '@/i18n'
import type { IconName } from '@/ui/Icon'

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
  { readonly label: string; readonly hint: string; color: string }
> = {
  backlog: category('backlog', 'var(--color-status-backlog)'),
  unstarted: category('unstarted', 'var(--color-status-todo)'),
  started: category('started', 'var(--color-status-progress)'),
  done: category('done', 'var(--color-status-done)'),
  cancelled: category('cancelled', 'var(--color-status-cancelled)'),
}

// The labels below are getters over the catalog (#106), so every caller keeps
// reading `PRIORITY_META[p].label` and gets the current language's word.
function category(key: StatusCategory, color: string) {
  return {
    color,
    get label() {
      return i18n.t(`issues:meta.category.${key}.label`)
    },
    get hint() {
      return i18n.t(`issues:meta.category.${key}.hint`)
    },
  }
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

/**
 * Issue types (#89): a label, an icon and a colour each. The icons differ in
 * outline, so the colour is never the only way to tell them apart.
 */
export const TYPE_META: Record<
  IssueType,
  { readonly label: string; icon: IconName; color: string }
> = {
  bug: type('bug', 'bug', 'var(--color-status-cancelled)'),
  task: type('task', 'task', 'var(--color-brand-500)'),
  story: type('story', 'story', 'var(--color-status-done)'),
}

function type(key: IssueType, icon: IconName, color: string) {
  return {
    icon,
    color,
    get label() {
      return i18n.t(`issues:meta.type.${key}`)
    },
  }
}

export const TYPE_ORDER: IssueType[] = ['task', 'bug', 'story']

export const PRIORITY_META: Record<IssuePriority, { readonly label: string; color: string }> = {
  urgent: priority('urgent', 'var(--color-priority-urgent)'),
  high: priority('high', 'var(--color-priority-high)'),
  medium: priority('medium', 'var(--color-priority-medium)'),
  low: priority('low', 'var(--color-priority-low)'),
  no_priority: priority('no_priority', 'var(--color-priority-none)'),
}

function priority(key: IssuePriority, color: string) {
  return {
    color,
    get label() {
      return i18n.t(`issues:meta.priority.${key}`)
    },
  }
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

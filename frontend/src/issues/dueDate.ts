import { format, parseISO } from 'date-fns'

import type { DueFilter } from '@/api/generated/models'
import { i18n } from '@/i18n'
import { formatDate } from '@/i18n/format'

/** Today in the viewer's own timezone, as the API's date strings are written. */
export function localToday(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

/**
 * Past its due date and still open (#87). Compared as `yyyy-MM-dd` strings
 * rather than Dates: a due date is a day, and parsing it into a timestamp
 * would move it across midnight for anybody west of UTC.
 */
export function isOverdue(dueDate: string, resolved: boolean, today = localToday()): boolean {
  return !resolved && dueDate < today
}

/** "Sep 12" -- compact, for a card. The pattern is the language's (#106). */
export function shortDue(dueDate: string): string {
  return formatDate(parseISO(dueDate), i18n.t('issues:meta.due.shortPattern'))
}

/** "Friday 12 September 2026" -- for a tooltip, where there is room. */
export function longDue(dueDate: string): string {
  return formatDate(parseISO(dueDate), i18n.t('issues:meta.due.longPattern'))
}

/** Getters over the catalog, so callers keep reading `DUE_FILTER_LABEL[due]`. */
export const DUE_FILTER_LABEL: Record<DueFilter, string> = {
  get overdue() {
    return i18n.t('issues:meta.due.overdue')
  },
  get this_week() {
    return i18n.t('issues:meta.due.this_week')
  },
  get none() {
    return i18n.t('issues:meta.due.none')
  },
}

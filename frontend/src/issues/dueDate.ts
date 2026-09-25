import { format, parseISO } from 'date-fns'

import type { DueFilter } from '@/api/generated/models'

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

/** "Sep 12" -- compact, for a card. */
export function shortDue(dueDate: string): string {
  return format(parseISO(dueDate), 'MMM d')
}

/** "Friday 12 September 2026" -- for a tooltip, where there is room. */
export function longDue(dueDate: string): string {
  return format(parseISO(dueDate), 'EEEE d MMMM yyyy')
}

export const DUE_FILTER_LABEL: Record<DueFilter, string> = {
  overdue: 'Overdue',
  this_week: 'Due this week',
  none: 'No due date',
}

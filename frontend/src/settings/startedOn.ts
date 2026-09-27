import { parseISO } from 'date-fns'

import { formatDate } from '@/i18n/format'

/**
 * A start date (#122) as the day it is: "14 Aug 2023".
 *
 * `parseISO` rather than `new Date()`, like a ticket's due date: the API sends
 * a bare `2023-08-14`, which `new Date()` reads as midnight UTC and a viewer
 * west of Greenwich would see as the 13th.
 */
export function formatStartedOn(value: string): string {
  return formatDate(parseISO(value), 'd MMM yyyy')
}

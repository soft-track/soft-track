import { addDays, endOfMonth, format, parseISO, startOfMonth } from 'date-fns'

import type { PaySchedule } from '@/api/generated/models'
import { i18n } from '@/i18n'
import { formatDate } from '@/i18n/format'

/** A run's period, as the API writes it. */
type Period = { period_start: string; period_end: string; pay_schedule?: PaySchedule }

const day = (value: string) => parseISO(value)
const iso = (value: Date) => format(value, 'yyyy-MM-dd')

/**
 * What a run is called (#132): "September 2026" for a calendar month,
 * "September 2026, 2nd half" for half of one, and the days themselves for
 * anything else -- a bi-weekly run, or a month that starts on the 26th.
 */
export function runTitle({ period_start, period_end }: Period): string {
  const start = day(period_start)
  const end = day(period_end)
  const month = formatDate(start, 'MMMM yyyy')
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
  if (sameMonth && start.getDate() === 1 && iso(endOfMonth(start)) === period_end) {
    return month
  }
  if (sameMonth && start.getDate() === 1 && end.getDate() === 15) {
    return i18n.t('finance:payroll.firstHalf', { month })
  }
  if (sameMonth && start.getDate() === 16 && iso(endOfMonth(start)) === period_end) {
    return i18n.t('finance:payroll.secondHalf', { month })
  }
  return periodRange({ period_start, period_end })
}

/** "1–30 Sep 2026": the days a run covers. */
export function periodRange({ period_start, period_end }: Period): string {
  return i18n.t('common:dateRange', {
    start: formatDate(day(period_start), 'd MMM yyyy'),
    end: formatDate(day(period_end), 'd MMM yyyy'),
  })
}

/**
 * Where a new run on a schedule most likely starts and ends: the period
 * after that schedule's latest run, or the one around today. Only a
 * suggestion -- the dates stay editable, for payroll that runs from the 26th.
 */
export function nextPeriod(
  schedule: PaySchedule,
  latest: Period | undefined,
  today: Date = new Date(),
): { period_start: string; period_end: string } {
  const start = latest ? addDays(day(latest.period_end), 1) : today
  if (schedule === 'bi_weekly') {
    return { period_start: iso(start), period_end: iso(addDays(start, 13)) }
  }
  if (schedule === 'semi_monthly') {
    const first = latest ? start : startOfMonth(today)
    const secondHalf = latest ? start.getDate() > 1 : today.getDate() > 15
    const monthStart = startOfMonth(first)
    return secondHalf
      ? { period_start: iso(addDays(monthStart, 15)), period_end: iso(endOfMonth(monthStart)) }
      : { period_start: iso(monthStart), period_end: iso(addDays(monthStart, 14)) }
  }
  const monthStart = startOfMonth(latest ? start : today)
  return { period_start: iso(monthStart), period_end: iso(endOfMonth(monthStart)) }
}

import {
  addMonths,
  addQuarters,
  addYears,
  endOfMonth,
  endOfQuarter,
  endOfYear,
  format,
  getQuarter,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfYear,
} from 'date-fns'

import { i18n } from '@/i18n'
import { formatDate } from '@/i18n/format'

export type Granularity = 'month' | 'quarter' | 'year'

/** A budget period, as the API writes one. */
export type Period = { start: string; end: string }

const iso = (value: Date) => format(value, 'yyyy-MM-dd')

const STEP = { month: addMonths, quarter: addQuarters, year: addYears }
const START = { month: startOfMonth, quarter: startOfQuarter, year: startOfYear }
const END = { month: endOfMonth, quarter: endOfQuarter, year: endOfYear }

/** The period of this granularity holding `day`. */
export function periodOf(granularity: Granularity, day: Date): Period {
  return { start: iso(START[granularity](day)), end: iso(END[granularity](day)) }
}

/**
 * The periods to choose from (#134): the current one, those before it and a
 * few ahead -- a budget is often set before its quarter begins.
 */
export function periodsAround(
  granularity: Granularity,
  today: Date = new Date(),
  { back = 8, ahead = 2 } = {},
): Period[] {
  const periods: Period[] = []
  for (let step = ahead; step >= -back; step -= 1) {
    periods.push(periodOf(granularity, STEP[granularity](today, step)))
  }
  return periods
}

/** "September 2026", "Q3 2026 · 1 Jul – 30 Sep", "2026", or the days. */
export function periodLabel(period: Period): string {
  const start = parseISO(period.start)
  const end = parseISO(period.end)
  for (const granularity of ['month', 'quarter', 'year'] as const) {
    const whole = periodOf(granularity, start)
    if (whole.start !== period.start || whole.end !== period.end) continue
    if (granularity === 'month') return formatDate(start, 'MMMM yyyy')
    if (granularity === 'year') return formatDate(start, 'yyyy')
    return i18n.t('finance:budgets.quarter', {
      quarter: getQuarter(start),
      year: formatDate(start, 'yyyy'),
      start: formatDate(start, 'd MMM'),
      end: formatDate(end, 'd MMM'),
    })
  }
  return i18n.t('common:dateRange', {
    start: formatDate(start, 'd MMM yyyy'),
    end: formatDate(end, 'd MMM yyyy'),
  })
}

/** Which granularity a period is a whole one of, if any. */
export function granularityOf(period: Period): Granularity | null {
  for (const granularity of ['month', 'quarter', 'year'] as const) {
    const whole = periodOf(granularity, parseISO(period.start))
    if (whole.start === period.start && whole.end === period.end) return granularity
  }
  return null
}

/** "Q3 2026" where `periodLabel` says "Q3 2026 · 1 Jul – 30 Sep": for a title. */
export function periodShortLabel(period: Period): string {
  if (granularityOf(period) !== 'quarter') return periodLabel(period)
  const start = parseISO(period.start)
  return i18n.t('finance:budgets.quarterShort', {
    quarter: getQuarter(start),
    year: formatDate(start, 'yyyy'),
  })
}

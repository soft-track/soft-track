import { parseISO, subMonths, subQuarters, subYears } from 'date-fns'

import type { BudgetRow, PayrollMonth } from '@/api/generated/models'
import { type Granularity, type Period, periodOf } from '@/finance/budgetPeriods'
import { formatNumber } from '@/i18n/format'

/**
 * The finance reports' arithmetic (#135), kept apart from the drawing so it
 * can be read, and tested, as numbers.
 *
 * A month with no approved run is `null` all the way through -- absent, not
 * zero and not the month before -- and every chart leaves a gap for it.
 */

/** The currencies the months paid in, by code: the order, and so the ink, on every chart. */
export function reportCurrencies(months: PayrollMonth[]): string[] {
  return [...new Set(months.flatMap((month) => month.costs.map((cost) => cost.currency)))].sort()
}

/**
 * One currency's cost per month. Null where no run was approved; zero where
 * runs were, and nobody on them was paid in this currency.
 */
export function costSeries(months: PayrollMonth[], currency: string): (number | null)[] {
  return months.map((month) =>
    month.runs === 0
      ? null
      : (month.costs.find((cost) => cost.currency === currency)?.amount_minor ?? 0),
  )
}

/** People paid each month; null where no run was approved. */
export function headcountSeries(months: PayrollMonth[]): (number | null)[] {
  return months.map((month) => (month.runs === 0 ? null : month.headcount))
}

/**
 * Values as an index of the first one there is: 100 where the line starts.
 *
 * The start is the first month with something in it, so a currency somebody
 * was first paid in during June starts at 100 in June rather than dividing
 * by May's nothing. Each series is its own base, which is what lets pounds
 * and dollars share an axis without either being converted.
 */
export function indexed(values: (number | null)[]): (number | null)[] {
  const start = values.findIndex((value) => value !== null && value > 0)
  if (start < 0) return values.map(() => null)
  const base = values[start]!
  return values.map((value, i) => (i < start || value === null ? null : (value / base) * 100))
}

/** "+27%": an index's distance from 100, rounded to a whole percent. */
export function formatGrowth(index: number): string {
  return formatNumber(Math.round(index - 100) / 100, {
    style: 'percent',
    maximumFractionDigits: 0,
    signDisplay: 'exceptZero',
  })
}

/**
 * "€24.7K": an amount in minor units, short enough for an axis or a heading.
 *
 * The minimum is said outright: left to the engine, a currency's own two
 * places lift it to the maximum on some -- Node 20 and the browsers of its
 * age write "€14.0K" and "€0.0" where newer ones write "€14K" and "€0".
 */
export function formatMoneyShort(minor: number, currency: string, places: number): string {
  return formatNumber(minor / 10 ** places, {
    style: 'currency',
    currency,
    notation: 'compact',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })
}

/** A round number at or above `value` for the top of an axis: 1, 2, 2.5 or 5 of a power of ten. */
export function niceCeiling(value: number): number {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  return ([1, 2, 2.5, 5, 10].find((step) => value <= step * power) ?? 10) * power
}

/** The last index holding a value, or -1. */
export function lastValueAt(values: (number | null)[]): number {
  for (let i = values.length - 1; i >= 0; i -= 1) if (values[i] !== null) return i
  return -1
}

const BACK = { month: subMonths, quarter: subQuarters, year: subYears }

/**
 * The periods the spend chart offers: every month, quarter and year from
 * the one holding `begins` to the one holding today, newest first -- never
 * one nothing could have been spent in yet, and never one before the data.
 */
export function reportPeriods(begins: string, today: Date): Record<Granularity, Period[]> {
  const first = parseISO(begins)
  const periods = {} as Record<Granularity, Period[]>
  for (const granularity of ['month', 'quarter', 'year'] as const) {
    const start = periodOf(granularity, first).start
    periods[granularity] = []
    for (let step = 0; ; step += 1) {
      const period = periodOf(granularity, BACK[granularity](today, step))
      if (period.start < start) break
      periods[granularity].push(period)
    }
  }
  return periods
}

/**
 * The budget overview's rows grouped by currency, by code, each keeping the
 * overview's order: departments by name, Unattributed last. One scale per
 * group -- a dollar bar and a pound bar never share an axis.
 */
export function byCurrency(rows: BudgetRow[]): [string, BudgetRow[]][] {
  const groups = new Map<string, BudgetRow[]>()
  for (const row of rows) groups.set(row.currency, [...(groups.get(row.currency) ?? []), row])
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

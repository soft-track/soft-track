/** The finance reports' arithmetic (#135): absent months, indexes, scales. */
import { describe, expect, it } from 'vitest'

import type { BudgetRow, PayrollMonth } from '@/api/generated/models'
import {
  byCurrency,
  costSeries,
  formatGrowth,
  formatMoneyShort,
  headcountSeries,
  indexed,
  lastValueAt,
  niceCeiling,
  reportCurrencies,
  reportPeriods,
} from '@/finance/reportSeries'

function month(
  day: string,
  headcount: number,
  costs: Record<string, number>,
  fields: Partial<PayrollMonth> = {},
): PayrollMonth {
  return {
    month: day,
    runs: 1,
    draft_runs: 0,
    headcount,
    costs: Object.entries(costs).map(([currency, amount_minor]) => ({
      currency: currency as PayrollMonth['costs'][number]['currency'],
      amount_minor,
      people: 1,
    })),
    ...fields,
  }
}

const MONTHS = [
  month('2026-07-01', 3, { GBP: 1355000, EUR: 500000 }),
  month('2026-08-01', 4, { GBP: 1355000, EUR: 500000, USD: 795000 }),
  month('2026-09-01', 0, {}, { runs: 0, draft_runs: 1 }),
]

describe('series', () => {
  it('lists the currencies paid in, by code', () => {
    expect(reportCurrencies(MONTHS)).toEqual(['EUR', 'GBP', 'USD'])
    expect(reportCurrencies([])).toEqual([])
  })

  it('tells a month nobody approved from a month nothing was paid in', () => {
    // July had a run, and nobody on it paid in dollars: zero. September's run
    // is a draft: absent, and never August again.
    expect(costSeries(MONTHS, 'USD')).toEqual([0, 795000, null])
    expect(headcountSeries(MONTHS)).toEqual([3, 4, null])
  })

  it('indexes a line to where it starts, and keeps its gaps', () => {
    expect(indexed([0, 500, 600, null, 650])).toEqual([null, 100, 120, null, 130])
    expect(indexed([null, 0, null])).toEqual([null, null, null])
  })

  it('finds where a line ends', () => {
    expect(lastValueAt([1, 2, null])).toBe(1)
    expect(lastValueAt([null, null])).toBe(-1)
  })
})

describe('numbers', () => {
  it('rounds growth to a whole percent, signed', () => {
    expect(formatGrowth(127.3)).toBe('+27%')
    expect(formatGrowth(88)).toBe('-12%')
    expect(formatGrowth(100.2)).toBe('0%')
  })

  it('shortens money in its own currency, with no trailing zero', () => {
    expect(formatMoneyShort(2470000, 'EUR', 2)).toBe('€24.7K')
    expect(formatMoneyShort(1400000, 'EUR', 2)).toBe('€14K')
    expect(formatMoneyShort(0, 'GBP', 2)).toBe('£0')
    expect(formatMoneyShort(1250000, 'JPY', 0)).toBe('¥1.3M')
  })

  it('tops an axis with a round number', () => {
    expect(niceCeiling(2470000)).toBe(2500000)
    expect(niceCeiling(1300)).toBe(2000)
    expect(niceCeiling(7)).toBe(10)
    expect(niceCeiling(0)).toBe(1)
  })
})

describe('periods', () => {
  it('offers every month, quarter and year since the data began, never before or ahead', () => {
    const periods = reportPeriods('2026-03-01', new Date(2026, 8, 29))
    expect(periods.month.map((period) => period.start)).toEqual([
      '2026-09-01',
      '2026-08-01',
      '2026-07-01',
      '2026-06-01',
      '2026-05-01',
      '2026-04-01',
      '2026-03-01',
    ])
    expect(periods.quarter.map((period) => period.start)).toEqual([
      '2026-07-01',
      '2026-04-01',
      '2026-01-01',
    ])
    expect(periods.year).toEqual([{ start: '2026-01-01', end: '2026-12-31' }])
  })

  it('groups the budget overview by currency, keeping its order', () => {
    const row = (name: string | null, currency: BudgetRow['currency']): BudgetRow => ({
      department: name ? { id: name.length, name } : null,
      currency,
      budget: null,
      actual_minor: 1,
    })
    const groups = byCurrency([
      row('Design', 'USD'),
      row('Engineering', 'EUR'),
      row('Engineering', 'USD'),
      row(null, 'EUR'),
    ])
    expect(
      groups.map(([currency, rows]) => [currency, rows.map((r) => r.department?.name ?? null)]),
    ).toEqual([
      ['EUR', ['Engineering', null]],
      ['USD', ['Design', 'Engineering']],
    ])
  })
})

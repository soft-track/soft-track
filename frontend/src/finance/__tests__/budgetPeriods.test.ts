/** Budget periods (#134): months, quarters and years, and anything else. */
import { describe, expect, it } from 'vitest'

import {
  granularityOf,
  periodLabel,
  periodOf,
  periodShortLabel,
  periodsAround,
} from '@/finance/budgetPeriods'

const day = new Date(2026, 8, 29)

describe('budget periods', () => {
  it('finds the month, quarter and year holding a day', () => {
    expect(periodOf('month', day)).toEqual({ start: '2026-09-01', end: '2026-09-30' })
    expect(periodOf('quarter', day)).toEqual({ start: '2026-07-01', end: '2026-09-30' })
    expect(periodOf('year', day)).toEqual({ start: '2026-01-01', end: '2026-12-31' })
  })

  it('offers the periods around today, the latest first', () => {
    const quarters = periodsAround('quarter', day, { back: 2, ahead: 1 })
    expect(quarters.map((period) => period.start)).toEqual([
      '2026-10-01',
      '2026-07-01',
      '2026-04-01',
      '2026-01-01',
    ])
  })

  it('names a whole month, quarter or year, and anything else by its days', () => {
    expect(periodLabel({ start: '2026-09-01', end: '2026-09-30' })).toBe('September 2026')
    expect(periodLabel({ start: '2026-07-01', end: '2026-09-30' })).toBe('Q3 2026 · 1 Jul – 30 Sep')
    expect(periodShortLabel({ start: '2026-07-01', end: '2026-09-30' })).toBe('Q3 2026')
    expect(periodLabel({ start: '2026-01-01', end: '2026-12-31' })).toBe('2026')
    expect(periodLabel({ start: '2026-04-01', end: '2027-03-31' })).toBe('1 Apr 2026 – 31 Mar 2027')
    expect(granularityOf({ start: '2026-04-01', end: '2027-03-31' })).toBeNull()
  })
})

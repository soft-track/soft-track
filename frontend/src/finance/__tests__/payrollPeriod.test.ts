/** What a run is called, and where the next one starts (#132). */
import { describe, expect, it } from 'vitest'

import { nextPeriod, periodRange, runTitle } from '@/finance/payrollPeriod'

const period = (period_start: string, period_end: string) => ({ period_start, period_end })

describe('runTitle', () => {
  it('names a calendar month, and each half of one', () => {
    expect(runTitle(period('2026-09-01', '2026-09-30'))).toBe('September 2026')
    expect(runTitle(period('2026-02-01', '2026-02-28'))).toBe('February 2026')
    expect(runTitle(period('2026-09-01', '2026-09-15'))).toBe('September 2026, 1st half')
    expect(runTitle(period('2026-09-16', '2026-09-30'))).toBe('September 2026, 2nd half')
  })

  it('gives the days for anything else', () => {
    expect(runTitle(period('2026-09-14', '2026-09-27'))).toBe('14 Sep 2026 – 27 Sep 2026')
    expect(runTitle(period('2026-08-26', '2026-09-25'))).toBe('26 Aug 2026 – 25 Sep 2026')
    expect(periodRange(period('2026-09-01', '2026-09-30'))).toBe('1 Sep 2026 – 30 Sep 2026')
  })
})

describe('nextPeriod', () => {
  const today = new Date(2026, 8, 29)

  it('follows the latest run on the schedule', () => {
    expect(nextPeriod('monthly', period('2026-08-01', '2026-08-31'), today)).toEqual(
      period('2026-09-01', '2026-09-30'),
    )
    expect(nextPeriod('semi_monthly', period('2026-09-01', '2026-09-15'), today)).toEqual(
      period('2026-09-16', '2026-09-30'),
    )
    expect(nextPeriod('semi_monthly', period('2026-09-16', '2026-09-30'), today)).toEqual(
      period('2026-10-01', '2026-10-15'),
    )
    expect(nextPeriod('bi_weekly', period('2026-09-14', '2026-09-27'), today)).toEqual(
      period('2026-09-28', '2026-10-11'),
    )
  })

  it('starts around today when there is no run yet', () => {
    expect(nextPeriod('monthly', undefined, today)).toEqual(period('2026-09-01', '2026-09-30'))
    expect(nextPeriod('semi_monthly', undefined, today)).toEqual(period('2026-09-16', '2026-09-30'))
    expect(nextPeriod('bi_weekly', undefined, today)).toEqual(period('2026-09-29', '2026-10-12'))
  })
})

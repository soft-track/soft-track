import { describe, expect, it } from 'vitest'

import { dayKey, monthGrid, monthParam, moveDay, parseMonth } from '@/calendar/month'

const d = (iso: string) => new Date(`${iso}T12:00:00`)

describe('the month grid (#105)', () => {
  it('reads and writes the month in the URL, ignoring anything else', () => {
    expect(monthParam(parseMonth('2026-09')!)).toBe('2026-09')
    for (const junk of [null, '', '2026-9', '2026-13', 'soon', '2026-09-01']) {
      expect(parseMonth(junk)).toBeNull()
    }
  })

  it('covers the month in whole Monday-to-Sunday weeks', () => {
    // September 2026 starts on a Tuesday and ends on a Wednesday.
    const weeks = monthGrid(d('2026-09-15'))
    expect(weeks).toHaveLength(5)
    expect(weeks.every((week) => week.length === 7)).toBe(true)
    expect(dayKey(weeks[0][0])).toBe('2026-08-31')
    expect(dayKey(weeks[4][6])).toBe('2026-10-04')
  })

  it('moves a day at a time, a week at a time, and a month at a time', () => {
    const day = d('2026-09-30') // a Wednesday
    expect(dayKey(moveDay(day, 'ArrowRight')!)).toBe('2026-10-01')
    expect(dayKey(moveDay(day, 'ArrowUp')!)).toBe('2026-09-23')
    expect(dayKey(moveDay(day, 'Home')!)).toBe('2026-09-28')
    expect(dayKey(moveDay(day, 'End')!)).toBe('2026-10-04')
    expect(dayKey(moveDay(day, 'PageDown')!)).toBe('2026-10-30')
    expect(moveDay(day, 'Enter')).toBeNull()
  })
})

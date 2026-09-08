import { describe, expect, it } from 'vitest'

import { formatCycleRange, parseServerDate } from '@/api/dates'

describe('parseServerDate', () => {
  it('reads a zoneless timestamp as UTC', () => {
    // Without the Z this is local time, and the answer would depend on where
    // the viewer happens to be -- which is the bug.
    expect(parseServerDate('2026-09-08T08:35:47').toISOString()).toBe(
      '2026-09-08T08:35:47.000Z',
    )
  })

  it('handles the microseconds the API sends', () => {
    expect(parseServerDate('2026-09-08T08:35:47.344335').toISOString()).toBe(
      '2026-09-08T08:35:47.344Z',
    )
  })

  it('leaves a timestamp that already names its zone alone', () => {
    expect(parseServerDate('2026-09-08T08:35:47Z').toISOString()).toBe(
      '2026-09-08T08:35:47.000Z',
    )
    expect(parseServerDate('2026-09-08T13:35:47+05:00').toISOString()).toBe(
      '2026-09-08T08:35:47.000Z',
    )
  })
})


describe('formatCycleRange', () => {
  it('keeps UTC day boundaries stable for viewers in other timezones', () => {
    expect(
      formatCycleRange('2026-09-08T00:00:00', '2026-09-22T23:59:59', 'UTC'),
    ).toBe('8 Sept – 22 Sept')
  })

  it('allows a caller to choose the calendar timezone explicitly', () => {
    expect(
      formatCycleRange('2026-09-08T00:00:00Z', '2026-09-08T23:59:59Z', 'America/Los_Angeles'),
    ).toBe('7 Sept – 8 Sept')
  })
})

import { describe, expect, it } from 'vitest'

import { parseServerDate } from '@/api/dates'

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

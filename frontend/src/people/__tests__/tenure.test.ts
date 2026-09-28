/** How long somebody has been here (#126). */
import { describe, expect, it } from 'vitest'

import { tenure } from '@/people/tenure'

const today = new Date('2026-09-28T12:00:00')

describe('tenure', () => {
  it('counts whole years, then months', () => {
    expect(tenure('2023-03-06', today)).toBe('3 years')
    expect(tenure('2025-09-01', today)).toBe('1 year')
    expect(tenure('2026-04-15', today)).toBe('5 months')
    expect(tenure('2026-08-28', today)).toBe('1 month')
  })

  it('is "less than a month" for somebody who just started', () => {
    expect(tenure('2026-09-01', today)).toBe('less than a month')
  })

  it('says nothing about a start that has not happened yet', () => {
    expect(tenure('2026-10-05', today)).toBeNull()
    expect(tenure('2026-09-30', today)).toBeNull()
  })
})

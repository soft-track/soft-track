import { describe, expect, it } from 'vitest'

import { replacingLosesWork } from '@/issues/templates'

describe('replacingLosesWork (#97)', () => {
  it('is false with nothing written', () => {
    expect(replacingLosesWork('', null)).toBe(false)
    expect(replacingLosesWork('  \n', null)).toBe(false)
  })

  it('is false while the description is exactly the last template', () => {
    expect(replacingLosesWork('## Steps', '## Steps')).toBe(false)
  })

  it('is true for anything the user wrote or changed', () => {
    expect(replacingLosesWork('notes', null)).toBe(true)
    expect(replacingLosesWork('## Steps\n1. crash', '## Steps')).toBe(true)
  })
})

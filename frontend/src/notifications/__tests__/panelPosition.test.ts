import { describe, expect, it } from 'vitest'

import { panelPosition } from '@/notifications/notificationMeta'

/** The bell, as a rect. Only `right` and `bottom` are read. */
const bell = (right: number, bottom = 60) => ({ right, bottom }) as DOMRect

describe('panelPosition', () => {
  it('right-aligns to the bell when there is room', () => {
    // A 1280px desktop with the bell near the right edge.
    expect(panelPosition(bell(1240), 1280)).toEqual({
      top: 68,
      right: 40,
      maxWidth: 1232,
    })
  })

  it('pins to the viewport edge when aligning to the bell would squeeze it', () => {
    // A 375px phone: the top bar has wrapped and the bell sits well left of
    // the edge, so right-aligning to it would push the panel off screen.
    const { right, maxWidth } = panelPosition(bell(300), 375)
    expect(right).toBe(8)
    expect(maxWidth).toBe(359)
  })

  it('never lets the panel hang off the right edge', () => {
    // A bell reported past the viewport (a mid-resize measurement).
    expect(panelPosition(bell(1400), 1280).right).toBe(8)
  })
})

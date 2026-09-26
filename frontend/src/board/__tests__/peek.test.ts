/**
 * Where the quick peek goes, and what of the description it shows (#113).
 */
import { describe, expect, it } from 'vitest'

import { type Box, placePeek, plainExcerpt } from '@/board/peek'

const VIEWPORT = { width: 1200, height: 800 }
const PEEK = { width: 320, height: 240 }

function box(left: number, top: number, width: number, height: number): Box {
  return { left, top, right: left + width, bottom: top + height }
}

/** Whether two boxes overlap at all. */
function overlaps(a: Box, b: Box) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

function peekBox(placed: { left: number; top: number }) {
  return box(placed.left, placed.top, PEEK.width, PEEK.height)
}

describe('placePeek', () => {
  it('sits to the right of a card, level with it', () => {
    const card = box(100, 200, 260, 90)
    expect(placePeek(card, PEEK, VIEWPORT)).toEqual({ side: 'right', left: 368, top: 200 })
  })

  it('flips to the left of a card near the right edge', () => {
    const card = box(900, 200, 260, 90)
    const placed = placePeek(card, PEEK, VIEWPORT)
    expect(placed.side).toBe('left')
    expect(placed.left + PEEK.width).toBe(892)
  })

  it('goes below a list row that spans the whole width, and above one at the bottom', () => {
    const row = box(16, 300, 1168, 40)
    expect(placePeek(row, PEEK, VIEWPORT)).toMatchObject({ side: 'below', top: 348 })

    const lastRow = box(16, 700, 1168, 40)
    const placed = placePeek(lastRow, PEEK, VIEWPORT)
    expect(placed.side).toBe('above')
    expect(placed.top + PEEK.height).toBe(692)
  })

  it('slides along the card to stay on screen, never onto it', () => {
    // A card near the bottom: the peek beside it moves up rather than off
    // the bottom of the screen -- and, being beside it, still misses it.
    const card = box(100, 700, 260, 90)
    const placed = placePeek(card, PEEK, VIEWPORT)
    expect(placed.side).toBe('right')
    expect(placed.top + PEEK.height).toBeLessThanOrEqual(VIEWPORT.height - 8)
    expect(overlaps(peekBox(placed), card)).toBe(false)
  })

  it('never covers the card it describes, wherever the card is', () => {
    for (let left = 0; left <= 940; left += 188) {
      for (let top = 0; top <= 710; top += 142) {
        const card = box(left, top, 260, 90)
        const placed = placePeek(card, PEEK, VIEWPORT)
        expect(overlaps(peekBox(placed), card), `card at ${left},${top}`).toBe(false)
      }
    }
  })

  it('stays inside a viewport too small to hold it anywhere', () => {
    const tiny = { width: 360, height: 300 }
    const placed = placePeek(box(20, 20, 320, 260), PEEK, tiny)
    expect(placed.left).toBeGreaterThanOrEqual(8)
    expect(placed.top).toBeGreaterThanOrEqual(8)
  })
})

describe('plainExcerpt', () => {
  it('keeps the first lines, skipping the blank ones', () => {
    expect(plainExcerpt('One.\n\nTwo.\nThree.\n\nFour.\nFive.')).toBe('One.\nTwo.\nThree.\nFour.')
  })

  it('takes the markdown syntax out and leaves the words', () => {
    const source = [
      '## Acceptance',
      '- [x] Pointer drag between **columns**',
      '1. See [the notes](https://example.com/notes)',
      '> quoted `code` and *emphasis*',
    ].join('\n')
    expect(plainExcerpt(source)).toBe(
      [
        'Acceptance',
        'Pointer drag between columns',
        'See the notes',
        'quoted code and emphasis',
      ].join('\n'),
    )
  })

  it('drops images, which are nothing but syntax in plain text', () => {
    expect(plainExcerpt('![screenshot](/attachments/4/content)\nThe crash.')).toBe('The crash.')
  })

  it('leaves the inside of a code fence as it is, and the fence lines out', () => {
    expect(plainExcerpt('Run:\n```\n- not a list\n```')).toBe('Run:\n- not a list')
  })

  it('does not mistake snake_case or a lone asterisk for emphasis', () => {
    expect(plainExcerpt('Set retry_max_wait to 5 * 60.')).toBe('Set retry_max_wait to 5 * 60.')
  })

  it('is empty for no description', () => {
    expect(plainExcerpt(null)).toBe('')
    expect(plainExcerpt('   \n\n')).toBe('')
  })
})

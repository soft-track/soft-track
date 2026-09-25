import type { KeyboardCoordinateGetter } from '@dnd-kit/core'
import { describe, expect, it, vi } from 'vitest'

import { announcements, columnCoordinates } from '@/board/keyboardDrag'

type Args = Parameters<KeyboardCoordinateGetter>[1]

function rect(left: number, width = 280) {
  return { left, width, top: 0, height: 600, right: left + width, bottom: 600 }
}

/** Three columns 300px apart, and a 280px card sitting in the middle one. */
function args(over: string | null = 'status:2'): Args {
  return {
    active: 1,
    currentCoordinates: { x: 300, y: 40 },
    context: {
      collisionRect: rect(300),
      droppableRects: new Map([
        ['status:3', rect(600)],
        ['status:1', rect(0)],
        ['status:2', rect(300)],
      ]),
      over: over ? { id: over } : null,
    },
  } as unknown as Args
}

// A stand-in rather than a real KeyboardEvent: this suite runs in node.
const press = (code: string) =>
  ({ code, preventDefault: vi.fn() }) as unknown as KeyboardEvent

describe('columnCoordinates', () => {
  it('jumps a whole column right or left, keeping the card level', () => {
    expect(columnCoordinates(press('ArrowRight'), args())).toEqual({ x: 600, y: 40 })
    expect(columnCoordinates(press('ArrowLeft'), args())).toEqual({ x: 0, y: 40 })
  })

  it('stops at the first and last column rather than running off the board', () => {
    expect(columnCoordinates(press('ArrowRight'), args('status:3'))).toEqual({ x: 600, y: 40 })
    expect(columnCoordinates(press('ArrowLeft'), args('status:1'))).toEqual({ x: 0, y: 40 })
  })

  it('works out the column from the card position when it is over none yet', () => {
    expect(columnCoordinates(press('ArrowRight'), args(null))).toEqual({ x: 600, y: 40 })
  })

  it('ignores anything that is not an arrow', () => {
    expect(columnCoordinates(press('KeyA'), args())).toBeUndefined()
  })

  it('steps up and down past the cards in the same column (#88)', () => {
    const withCards = args('status:2')
    const rects = withCards.context.droppableRects as Map<unknown, unknown>
    rects.set(7, { ...rect(310, 260), top: 40, height: 90 })
    rects.set(8, { ...rect(310, 260), top: 140, height: 90 })
    rects.set(9, { ...rect(310, 260), top: 240, height: 90 })
    // In another column, so never stepped to.
    rects.set(10, { ...rect(10, 260), top: 140, height: 90 })
    expect(columnCoordinates(press('ArrowDown'), withCards)).toEqual({ x: 300, y: 140 })
    expect(columnCoordinates(press('ArrowUp'), withCards)).toEqual({ x: 300, y: 40 })
  })

  it('does nothing on up or down with no cards to step past', () => {
    expect(columnCoordinates(press('ArrowDown'), args())).toBeUndefined()
  })

  it('keeps the arrow from scrolling the board as well', () => {
    const event = press('ArrowRight')
    columnCoordinates(event, args())
    expect(event.preventDefault).toHaveBeenCalled()
  })
})

describe('announcements', () => {
  const said = announcements({
    issueName: (id) => `ENG-${id}`,
    columnName: (id) =>
      ({ 'status:1': 'Todo', 'status:2': 'In Progress', 7: 'Todo' })[String(id)] ?? null,
    startColumn: () => 'Todo',
    drag: { moved: false },
  })
  const active = { id: 42 } as never
  const over = (id: string | null) => (id ? ({ id } as never) : null)

  it('reads out the move in plain words, never the ids', () => {
    expect(said.onDragStart({ active })).toMatch(/^Picked up ENG-42 in Todo\. .*Space to drop/)
    expect(said.onDragOver({ active, over: over('status:2') })).toBe('ENG-42 is over In Progress.')
    expect(said.onDragEnd({ active, over: over('status:2') })).toBe('Moved ENG-42 to In Progress.')
  })

  it('stays quiet about the starting column until the card has left it', () => {
    // Said in the same tick as the pickup, it would drown out the instructions.
    said.onDragStart({ active })
    expect(said.onDragOver({ active, over: over('status:1') })).toBeUndefined()
    expect(said.onDragOver({ active, over: over('status:2') })).toBe('ENG-42 is over In Progress.')
    // Coming back is a move like any other, and is said.
    expect(said.onDragOver({ active, over: over('status:1') })).toBe('ENG-42 is over Todo.')
  })

  it('says which card it is next to, since that is where it lands (#88)', () => {
    said.onDragStart({ active })
    expect(said.onDragOver({ active, over: over(7 as never) })).toBe(
      'ENG-42 is in Todo, next to ENG-7.',
    )
    expect(said.onDragEnd({ active, over: over(7 as never) })).toBe('Moved ENG-42 within Todo.')
  })

  it('says where the card stayed when nothing moved', () => {
    expect(said.onDragEnd({ active, over: over('status:1') })).toBe('ENG-42 stays in Todo.')
    expect(said.onDragEnd({ active, over: over(null) })).toMatch(/stays in Todo/)
    expect(said.onDragCancel({ active, over: over('status:2') })).toBe(
      'Move cancelled. ENG-42 stays in Todo.',
    )
  })
})

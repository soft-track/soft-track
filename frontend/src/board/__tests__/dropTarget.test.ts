import { describe, expect, it } from 'vitest'

import { resolveDrop } from '@/board/dropTarget'

const columns = [
  { id: 'status:1', issues: [{ id: 1 }, { id: 2 }, { id: 3 }] },
  { id: 'status:2', issues: [{ id: 4 }, { id: 5 }] },
  { id: 'status:3', issues: [] },
]

describe('resolveDrop', () => {
  it('moving down within a column takes the target card’s place', () => {
    expect(resolveDrop(columns, 1, 3)).toEqual({
      kind: 'place',
      columnId: 'status:1',
      aboveId: 3,
      belowId: null,
      changesColumn: false,
    })
  })

  it('moving up within a column goes above the target card', () => {
    expect(resolveDrop(columns, 3, 1)).toEqual({
      kind: 'place',
      columnId: 'status:1',
      aboveId: null,
      belowId: 1,
      changesColumn: false,
    })
  })

  it('onto a card in another column goes above that card', () => {
    expect(resolveDrop(columns, 2, 5)).toEqual({
      kind: 'place',
      columnId: 'status:2',
      aboveId: 4,
      belowId: 5,
      changesColumn: true,
    })
  })

  it('onto another column’s empty space changes column only', () => {
    expect(resolveDrop(columns, 2, 'status:3')).toEqual({ kind: 'column', columnId: 'status:3' })
  })

  it('back onto itself, or onto its own column, is nothing', () => {
    expect(resolveDrop(columns, 2, 2)).toEqual({ kind: 'none' })
    expect(resolveDrop(columns, 2, 'status:1')).toEqual({ kind: 'none' })
  })
})

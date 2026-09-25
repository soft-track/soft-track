import { describe, expect, it } from 'vitest'

import type { IssueRead, StatusRead } from '@/api/generated/models'
import { placeIssue } from '@/board/useMoveIssue'

const issue = (id: number) => ({ id, status: { id: 1 } }) as IssueRead
const ids = (items: IssueRead[]) => items.map((item) => item.id)
const LIST = [1, 2, 3, 4].map(issue)

describe('placeIssue (the optimistic move)', () => {
  it('puts the card just above the one below it', () => {
    expect(ids(placeIssue(LIST, 4, { aboveId: 1, belowId: 2 }))).toEqual([1, 4, 2, 3])
  })

  it('puts it just after the one above it at the bottom of a column', () => {
    expect(ids(placeIssue(LIST, 1, { aboveId: 3, belowId: null }))).toEqual([2, 3, 1, 4])
  })

  it('puts it first with no neighbours', () => {
    expect(ids(placeIssue(LIST, 3, { aboveId: null, belowId: null }))).toEqual([3, 1, 2, 4])
  })

  it('changes its column when told to', () => {
    const done = { id: 9 } as StatusRead
    const moved = placeIssue(LIST, 2, { aboveId: null, belowId: 4, status: done })
    expect(moved.find((item) => item.id === 2)?.status).toBe(done)
  })

  it('leaves the list alone for a card it does not hold', () => {
    expect(placeIssue(LIST, 99, { aboveId: 1, belowId: 2 })).toBe(LIST)
  })
})

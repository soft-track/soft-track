import { describe, expect, it } from 'vitest'

import {
  activeCount,
  type BoardFilters,
  fromSearchParams,
  fromViewFilters,
  isEmpty,
  NO_FILTERS,
  sameFilters,
  toQueryParams,
  toSearchParams,
  toViewFilters,
} from '@/board/filters'

const some: BoardFilters = {
  status: 'in_review',
  priority: 'urgent',
  assignee: 7,
  labelId: 3,
  projectId: 2,
  cycleId: 5,
}

describe('the URL round trip', () => {
  it('survives every filter being set', () => {
    expect(fromSearchParams(toSearchParams(some))).toEqual(some)
  })

  it('leaves an unfiltered board with a clean URL', () => {
    expect(toSearchParams(NO_FILTERS).toString()).toBe('')
    expect(fromSearchParams(new URLSearchParams())).toEqual(NO_FILTERS)
  })

  it('keeps "unassigned" distinct from "anyone"', () => {
    const unassigned = { ...NO_FILTERS, assignee: 'unassigned' as const }
    expect(toSearchParams(unassigned).get('assignee')).toBe('unassigned')
    expect(fromSearchParams(toSearchParams(unassigned))).toEqual(unassigned)
  })

  it('ignores a filter it cannot parse rather than passing it on', () => {
    // A truncated or hand-edited link should show an unfiltered board, not
    // send NaN to the API and get a 422.
    const params = new URLSearchParams('label=abc&project=-1&cycle=')
    expect(fromSearchParams(params)).toEqual(NO_FILTERS)
  })

  it('writes only the filters that are set', () => {
    const params = toSearchParams({ ...NO_FILTERS, priority: 'high' })
    expect(params.toString()).toBe('priority=high')
  })
})

describe('toQueryParams', () => {
  it('maps the board onto what the issue endpoint asks for', () => {
    expect(toQueryParams(some)).toEqual({
      status: 'in_review',
      priority: 'urgent',
      assignee_id: 7,
      unassigned: undefined,
      label_id: 3,
      project_id: 2,
      cycle_id: 5,
    })
  })

  it('sends unassigned as its own flag, not as an assignee', () => {
    const params = toQueryParams({ ...NO_FILTERS, assignee: 'unassigned' })
    expect(params.unassigned).toBe(true)
    expect(params.assignee_id).toBeUndefined()
  })

  it('sends nothing at all for an unfiltered board', () => {
    expect(Object.values(toQueryParams(NO_FILTERS)).every((v) => v === undefined)).toBe(
      true,
    )
  })
})

describe('the saved-view round trip', () => {
  it('survives every filter being set', () => {
    expect(fromViewFilters(toViewFilters(some))).toEqual(some)
  })

  it('carries unassigned across as the flag the API stores', () => {
    const stored = toViewFilters({ ...NO_FILTERS, assignee: 'unassigned' })
    expect(stored.unassigned).toBe(true)
    expect(stored.assignee_id).toBeNull()
    expect(fromViewFilters(stored).assignee).toBe('unassigned')
  })

  it('reads a view the API returned with fields omitted', () => {
    // Pydantic omits nothing today, but the fields are optional in the schema
    // and a partial object must not become a filter matching nothing.
    expect(fromViewFilters({})).toEqual(NO_FILTERS)
  })
})

describe('sameFilters', () => {
  it('is what lights up the saved view a link happens to match', () => {
    expect(sameFilters(some, { ...some })).toBe(true)
    expect(sameFilters(some, { ...some, cycleId: 6 })).toBe(false)
  })

  it('tells "unassigned" apart from a person', () => {
    expect(
      sameFilters({ ...NO_FILTERS, assignee: 'unassigned' }, { ...NO_FILTERS, assignee: 1 }),
    ).toBe(false)
  })
})

describe('activeCount', () => {
  it('counts the chips the filter bar will show', () => {
    expect(activeCount(NO_FILTERS)).toBe(0)
    expect(activeCount(some)).toBe(6)
    expect(isEmpty(NO_FILTERS)).toBe(true)
    expect(isEmpty({ ...NO_FILTERS, status: 'done' })).toBe(false)
  })
})

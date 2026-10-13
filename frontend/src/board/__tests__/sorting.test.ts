import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SORT,
  fromViewSort,
  sortFromSearchParams,
  toViewSort,
  withSort,
} from '@/board/sorting'

describe('the sort in the URL (#88)', () => {
  it('leaves the default out, so old links are unchanged', () => {
    expect(withSort(new URLSearchParams('priority=urgent'), DEFAULT_SORT).toString()).toBe(
      'priority=urgent',
    )
    expect(sortFromSearchParams(new URLSearchParams(''))).toEqual(DEFAULT_SORT)
  })

  it('round-trips any other sort', () => {
    const params = withSort(new URLSearchParams(), { sort: 'priority', direction: 'asc' })
    expect(params.toString()).toBe('sort=priority&dir=asc')
    expect(sortFromSearchParams(params)).toEqual({ sort: 'priority', direction: 'asc' })
  })

  it('reads an unknown sort as the default, and a missing direction as descending', () => {
    expect(sortFromSearchParams(new URLSearchParams('sort=vibes&dir=asc'))).toEqual(
      DEFAULT_SORT,
    )
    expect(sortFromSearchParams(new URLSearchParams('sort=title'))).toEqual({
      sort: 'title',
      direction: 'desc',
    })
  })
})

describe('the sort in a saved view', () => {
  it('stores the default as nulls, so an old view and a new one mean the same', () => {
    expect(toViewSort(DEFAULT_SORT)).toEqual({ sort: null, sort_direction: null })
    expect(fromViewSort(null, null)).toEqual(DEFAULT_SORT)
  })

  it('round-trips anything else', () => {
    const sort = { sort: 'estimate', direction: 'asc' } as const
    const stored = toViewSort(sort)
    expect(fromViewSort(stored.sort, stored.sort_direction)).toEqual(sort)
  })
})

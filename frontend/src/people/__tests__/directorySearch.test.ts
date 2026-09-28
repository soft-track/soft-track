/** The directory's filters in the URL (#125). */
import { describe, expect, it } from 'vitest'

import {
  fromSearchParams,
  hasFilters,
  NO_DIRECTORY_FILTERS,
  toQueryParams,
  toSearchParams,
} from '@/people/directorySearch'

const read = (query: string) => fromSearchParams(new URLSearchParams(query))

describe('directory filters in the URL', () => {
  it('reads a search, a department and a manager', () => {
    expect(read('q=+paris+&department=3&manager=amina')).toEqual({
      q: 'paris',
      departmentId: 3,
      manager: 'amina',
    })
  })

  it('reads a bare URL as no filters, and garbage as no filter', () => {
    expect(read('')).toEqual(NO_DIRECTORY_FILTERS)
    expect(read('department=engineering&manager=').departmentId).toBeNull()
    expect(read('department=-2').departmentId).toBeNull()
    expect(read('manager=%20%20').manager).toBeNull()
  })

  it('writes only what is set, and reads back what it wrote', () => {
    const filters = { q: 'staff', departmentId: 1, manager: null }
    expect(toSearchParams(filters).toString()).toBe('q=staff&department=1')
    expect(fromSearchParams(toSearchParams(filters))).toEqual(filters)
    expect(toSearchParams(NO_DIRECTORY_FILTERS).toString()).toBe('')
  })

  it('asks the API with its own parameter names', () => {
    expect(
      toQueryParams({ q: '', departmentId: 2, manager: 'amina' }, { limit: 50, offset: 100 }),
    ).toEqual({
      q: undefined,
      department_id: 2,
      manager: 'amina',
      limit: 50,
      offset: 100,
    })
  })

  it('knows when anything is filtered', () => {
    expect(hasFilters(NO_DIRECTORY_FILTERS)).toBe(false)
    expect(hasFilters({ ...NO_DIRECTORY_FILTERS, manager: 'amina' })).toBe(true)
  })
})

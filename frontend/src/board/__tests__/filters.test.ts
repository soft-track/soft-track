import { describe, expect, it } from 'vitest'

import {
  activeCount,
  type BoardFilters,
  fromSearchParams,
  fromViewFilters,
  isEmpty,
  NO_FILTERS,
  sameFilters,
  searchString,
  toggleValue,
  toQueryParams,
  toQueryString,
  toSearchParams,
  toViewFilters,
  withoutValue,
} from '@/board/filters'

const one = <T,>(value: T) => ({ values: [value], exclude: false })

const some: BoardFilters = {
  status: one(9),
  priority: one('urgent' as const),
  assignee: one(7),
  label: { ...one(3), match: 'any' },
  projectId: 2,
  sprintId: 5,
  due: 'overdue',
  type: one('bug' as const),
}

/** Mei or Daniel, and bugs or stories, and not Done: the mockup's board. */
const several: BoardFilters = {
  ...NO_FILTERS,
  assignee: { values: [3, 4], exclude: false },
  type: { values: ['bug', 'story'], exclude: false },
  status: { values: [5], exclude: true },
  label: { values: [1, 2], exclude: false, match: 'all' },
}

describe('the URL round trip', () => {
  it('survives every filter being set', () => {
    expect(fromSearchParams(toSearchParams(some))).toEqual(some)
  })

  it('survives several values, exclusions and all-of-these labels', () => {
    expect(fromSearchParams(toSearchParams(several))).toEqual(several)
  })

  it('repeats a filter for several values, and writes an exclusion with !=', () => {
    expect(searchString(toSearchParams(several))).toBe(
      'status!=5&assignee=3&assignee=4&label=1&label=2&label_match=all&type=bug&type=story',
    )
  })

  it('reads a link from before lists as a list of one (#260)', () => {
    expect(fromSearchParams(new URLSearchParams('assignee=3&type=bug'))).toEqual({
      ...NO_FILTERS,
      assignee: one(3),
      type: one('bug'),
    })
  })

  it('reads an exclusion whether or not the ! was escaped', () => {
    for (const query of ['status!=5', 'status%21=5']) {
      expect(fromSearchParams(new URLSearchParams(query)).status).toEqual({
        values: [5],
        exclude: true,
      })
    }
  })

  it('leaves an unfiltered board with a clean URL', () => {
    expect(toSearchParams(NO_FILTERS).toString()).toBe('')
    expect(fromSearchParams(new URLSearchParams())).toEqual(NO_FILTERS)
  })

  it('keeps "unassigned" distinct from "anyone", and beside people', () => {
    const unassigned = { ...NO_FILTERS, assignee: { values: ['unassigned' as const, 3], exclude: false } }
    expect(toSearchParams(unassigned).getAll('assignee')).toEqual(['unassigned', '3'])
    expect(fromSearchParams(toSearchParams(unassigned))).toEqual(unassigned)
  })

  it('drops the values it cannot parse and keeps the rest', () => {
    // A truncated or hand-edited link should show a wider board, not send
    // NaN to the API and get a 422.
    const params = new URLSearchParams('status=abc&label=abc&project=-1&sprint=&priority=huge')
    expect(fromSearchParams(params)).toEqual(NO_FILTERS)
    expect(fromSearchParams(new URLSearchParams('assignee=3&assignee=x&assignee=3')).assignee)
      .toEqual(one(3))
  })

  it('writes only the filters that are set', () => {
    const params = toSearchParams({ ...NO_FILTERS, priority: one('high') })
    expect(params.toString()).toBe('priority=high')
  })

  it('does not write all-of-these for a single label, where it means nothing', () => {
    const params = toSearchParams({ ...NO_FILTERS, label: { ...one(1), match: 'all' } })
    expect(params.toString()).toBe('label=1')
  })

  it('still reads a link sent while sprints were called cycles (#214)', () => {
    expect(fromSearchParams(new URLSearchParams('cycle=5'))).toEqual({
      ...NO_FILTERS,
      sprintId: 5,
    })
    // Written the new way from then on, and the new key wins over the old.
    expect(toSearchParams({ ...NO_FILTERS, sprintId: 5 }).toString()).toBe('sprint=5')
    expect(fromSearchParams(new URLSearchParams('sprint=6&cycle=5')).sprintId).toBe(6)
  })
})

describe('toQueryParams', () => {
  it('maps the board onto what the ticket endpoint asks for', () => {
    expect(toQueryParams(some, '2026-09-23')).toEqual({
      status_id: [9],
      status_exclude: undefined,
      priority: ['urgent'],
      priority_exclude: undefined,
      assignee_id: [7],
      unassigned: undefined,
      assignee_exclude: undefined,
      label_id: [3],
      label_match: undefined,
      label_exclude: undefined,
      type: ['bug'],
      type_exclude: undefined,
      project_id: 2,
      sprint_id: 5,
      due: 'overdue',
      today: '2026-09-23',
    })
  })

  it('sends several values, the switches and all-of-these', () => {
    const params = toQueryParams(several)
    expect(params.assignee_id).toEqual([3, 4])
    expect(params.status_id).toEqual([5])
    expect(params.status_exclude).toBe(true)
    expect(params.label_match).toBe('all')
  })

  it('sends no switch for a filter with nothing chosen', () => {
    const params = toQueryParams({ ...NO_FILTERS, status: { values: [], exclude: true } })
    expect(params.status_id).toBeUndefined()
    expect(params.status_exclude).toBeUndefined()
  })

  it("sends the viewer's own today with a due filter, and not without one (#87)", () => {
    expect(toQueryParams({ ...NO_FILTERS, due: 'this_week' }, '2026-09-27').today).toBe(
      '2026-09-27',
    )
    expect(toQueryParams({ ...NO_FILTERS, status: one(4) }, '2026-09-27').today).toBeUndefined()
  })

  it('reads an unknown due value in a link as no filter', () => {
    expect(fromSearchParams(new URLSearchParams('due=someday')).due).toBeNull()
  })

  it('sends unassigned as its own flag, not as an assignee', () => {
    const params = toQueryParams({ ...NO_FILTERS, assignee: one('unassigned' as const) })
    expect(params.unassigned).toBe(true)
    expect(params.assignee_id).toBeUndefined()
  })

  it('sends nothing at all for an unfiltered board', () => {
    expect(Object.values(toQueryParams(NO_FILTERS)).every((v) => v === undefined)).toBe(
      true,
    )
  })

  it('flattens to a query string with lists repeated, for the export', () => {
    expect(toQueryString(several).toString()).toBe(
      'status_id=5&status_exclude=true&assignee_id=3&assignee_id=4' +
        '&label_id=1&label_id=2&label_match=all&type=bug&type=story',
    )
  })
})

describe('the saved-view round trip', () => {
  it('survives every filter being set', () => {
    expect(fromViewFilters(toViewFilters(some))).toEqual(some)
    expect(fromViewFilters(toViewFilters(several))).toEqual(several)
  })

  it('carries unassigned across as the flag the API stores', () => {
    const stored = toViewFilters({
      ...NO_FILTERS,
      assignee: { values: ['unassigned', 3], exclude: false },
    })
    expect(stored.unassigned).toBe(true)
    expect(stored.assignee_id).toEqual([3])
    expect(fromViewFilters(stored).assignee.values).toEqual(['unassigned', 3])
  })

  it('reads a view the API returned with fields omitted', () => {
    // A partial object must not become a filter matching nothing.
    expect(fromViewFilters({})).toEqual(NO_FILTERS)
  })
})

describe('choosing values', () => {
  it('keeps the values in the order the menu lists them', () => {
    const order = [1, 2, 3, 4]
    let filters = toggleValue(NO_FILTERS, 'assignee', 4, order)
    filters = toggleValue(filters, 'assignee', 2, order)
    expect(filters.assignee.values).toEqual([2, 4])
    expect(toggleValue(filters, 'assignee', 4, order).assignee.values).toEqual([2])
  })

  it('takes one value out and leaves the rest of the filter', () => {
    expect(withoutValue(several, 'assignee', 3).assignee).toEqual(one(4))
    expect(withoutValue(several, 'status', 5).status).toEqual({ values: [], exclude: true })
  })
})

describe('sameFilters', () => {
  it('is what lights up the saved view a link happens to match', () => {
    expect(sameFilters(some, { ...some })).toBe(true)
    expect(sameFilters(some, { ...some, sprintId: 6 })).toBe(false)
  })

  it('does not care about the order of values, or a switch with nothing chosen', () => {
    expect(
      sameFilters(several, { ...several, assignee: { values: [4, 3], exclude: false } }),
    ).toBe(true)
    expect(sameFilters(NO_FILTERS, { ...NO_FILTERS, type: { values: [], exclude: true } })).toBe(
      true,
    )
    expect(sameFilters(several, { ...several, status: one(5) })).toBe(false)
    expect(sameFilters(several, { ...several, label: { ...several.label, match: 'any' } })).toBe(
      false,
    )
  })

  it('tells "unassigned" apart from a person', () => {
    expect(
      sameFilters(
        { ...NO_FILTERS, assignee: one('unassigned' as const) },
        { ...NO_FILTERS, assignee: one(1) },
      ),
    ).toBe(false)
  })
})

describe('activeCount', () => {
  it('counts the chips the filter bar will show: one per filter', () => {
    expect(activeCount(NO_FILTERS)).toBe(0)
    expect(activeCount(some)).toBe(8)
    expect(activeCount(several)).toBe(4)
    expect(isEmpty(NO_FILTERS)).toBe(true)
    expect(isEmpty({ ...NO_FILTERS, status: one(4) })).toBe(false)
  })
})

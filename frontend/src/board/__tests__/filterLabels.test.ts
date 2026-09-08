import { describe, expect, it } from 'vitest'

import type {
  CycleRead,
  LabelRead,
  ProjectRead,
  StatusRead,
  TeamMemberRead,
} from '@/api/generated/models'
import { describeFilters, summarise, withoutFilter } from '@/board/filterLabels'
import { NO_FILTERS } from '@/board/filters'

const lookups = {
  members: [
    { user: { id: 7, full_name: 'Sam Rivera' }, role: 'member', joined_at: '' },
  ] as unknown as TeamMemberRead[],
  labels: [{ id: 3, team_id: 1, name: 'Bug', color: '#f00' }] as LabelRead[],
  projects: [{ id: 2, team_id: 1, name: 'Platform' }] as unknown as ProjectRead[],
  cycles: [{ id: 5, display_name: 'Cycle 5' }] as unknown as CycleRead[],
  statuses: [
    { id: 9, name: 'In Review', category: 'started' },
  ] as unknown as StatusRead[],
}

describe('describeFilters', () => {
  it('names every active filter and leaves the rest out', () => {
    const chips = describeFilters(
      { statusId: 9, priority: 'urgent', assignee: 7, labelId: 3, projectId: 2, cycleId: 5 },
      lookups,
    )
    expect(chips.map((c) => `${c.field}: ${c.value}`)).toEqual([
      'Status: In Review',
      'Priority: Urgent',
      'Assignee: Sam Rivera',
      'Label: Bug',
      'Project: Platform',
      'Cycle: Cycle 5',
    ])
  })

  it('has nothing to say about an unfiltered board', () => {
    expect(describeFilters(NO_FILTERS, lookups)).toEqual([])
  })

  it('distinguishes unassigned from a person', () => {
    const [chip] = describeFilters({ ...NO_FILTERS, assignee: 'unassigned' }, lookups)
    expect(chip.value).toBe('Unassigned')
  })

  it('still renders a chip for something that has since been deleted', () => {
    // The filter is still narrowing the board, so it has to stay visible and
    // dismissible -- dropping the chip would leave a board filtered for no
    // reason anyone can see. A status can be deleted now too.
    const chips = describeFilters(
      { ...NO_FILTERS, statusId: 777, labelId: 999, cycleId: 888 },
      lookups,
    )
    expect(chips.map((c) => c.value)).toEqual([
      'Deleted status',
      'Deleted label',
      'Deleted cycle',
    ])
  })

  it('works before the team data has loaded', () => {
    const [chip] = describeFilters({ ...NO_FILTERS, assignee: 7 })
    expect(chip.field).toBe('Assignee')
  })
})

describe('summarise', () => {
  it('describes a saved view in one line', () => {
    expect(summarise({ ...NO_FILTERS, priority: 'urgent', labelId: 3 }, lookups)).toBe(
      'Urgent · Bug',
    )
  })

  it('calls an empty view what it is', () => {
    expect(summarise(NO_FILTERS, lookups)).toBe('All issues')
  })
})

describe('withoutFilter', () => {
  it('clears one filter and leaves the others', () => {
    const filters = { ...NO_FILTERS, priority: 'high' as const, labelId: 3 }
    expect(withoutFilter(filters, 'labelId')).toEqual({ ...NO_FILTERS, priority: 'high' })
  })
})

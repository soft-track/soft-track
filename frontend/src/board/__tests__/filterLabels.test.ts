import { describe, expect, it } from 'vitest'

import type {
  SprintRead,
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
  sprints: [{ id: 5, display_name: 'Sprint 5' }] as unknown as SprintRead[],
  statuses: [
    { id: 9, name: 'In Review', category: 'started' },
  ] as unknown as StatusRead[],
}

const one = <T,>(value: T) => ({ values: [value], exclude: false })

describe('describeFilters', () => {
  it('names every active filter and leaves the rest out', () => {
    const chips = describeFilters(
      {
        status: one(9),
        priority: one('urgent' as const),
        assignee: one(7),
        label: { ...one(3), match: 'any' },
        projectId: 2,
        sprintId: 5,
        due: 'overdue',
        type: one('bug' as const),
      },
      lookups,
    )
    expect(chips.map((c) => `${c.field}: ${c.value}`)).toEqual([
      'Status: In Review',
      'Priority: Urgent',
      'Assignee: Sam Rivera',
      'Label: Bug',
      'Epic: Platform',
      'Sprint: Sprint 5',
      'Type: Bug',
      'Due: Overdue',
    ])
  })

  it('reads several values as alternatives, and an exclusion as not (#260)', () => {
    const chips = describeFilters(
      {
        ...NO_FILTERS,
        assignee: { values: [7, 'unassigned'], exclude: false },
        status: { values: [9], exclude: true },
        type: { values: ['bug', 'story'], exclude: false },
      },
      lookups,
    )
    expect(chips.map((c) => `${c.field}: ${c.value}`)).toEqual([
      'Status: not In Review',
      'Assignee: Sam Rivera or Unassigned',
      'Type: Bug or Story',
    ])
  })

  it('joins labels with and when every one of them must be there', () => {
    const labels = [...lookups.labels, { id: 4, team_id: 1, name: 'Design', color: '#00f' }]
    const filters = { ...NO_FILTERS, label: { values: [3, 4], exclude: false, match: 'all' as const } }
    expect(describeFilters(filters, { ...lookups, labels })[0].value).toBe('Bug and Design')
  })

  it('takes one value out of a chip and leaves the others', () => {
    const filters = { ...NO_FILTERS, type: { values: ['bug' as const, 'story' as const], exclude: true } }
    const [chip] = describeFilters(filters, lookups)
    expect(chip.parts.map((part) => part.label)).toEqual(['Bug', 'Story'])
    expect(chip.parts[0].without.type).toEqual({ values: ['story'], exclude: true })
  })

  it('has nothing to say about an unfiltered board', () => {
    expect(describeFilters(NO_FILTERS, lookups)).toEqual([])
  })

  it('distinguishes unassigned from a person', () => {
    const [chip] = describeFilters({ ...NO_FILTERS, assignee: one('unassigned' as const) }, lookups)
    expect(chip.value).toBe('Unassigned')
  })

  it('still renders a chip for something that has since been deleted', () => {
    // The filter is still narrowing the board, so it has to stay visible and
    // dismissible -- dropping the chip would leave a board filtered for no
    // reason anyone can see. A status can be deleted now too.
    const chips = describeFilters(
      { ...NO_FILTERS, status: one(777), label: { ...one(999), match: 'any' }, sprintId: 888 },
      lookups,
    )
    expect(chips.map((c) => c.value)).toEqual([
      'Deleted status',
      'Deleted label',
      'Deleted sprint',
    ])
  })

  it('works before the team data has loaded', () => {
    const [chip] = describeFilters({ ...NO_FILTERS, assignee: one(7) })
    expect(chip.field).toBe('Assignee')
  })
})

describe('summarise', () => {
  it('describes a saved view in one line', () => {
    expect(
      summarise(
        { ...NO_FILTERS, priority: one('urgent' as const), label: { ...one(3), match: 'any' } },
        lookups,
      ),
    ).toBe('Urgent · Bug')
  })

  it('calls an empty view what it is', () => {
    expect(summarise(NO_FILTERS, lookups)).toBe('All tickets')
  })
})

describe('withoutFilter', () => {
  it('clears one filter and leaves the others', () => {
    const filters = {
      ...NO_FILTERS,
      priority: one('high' as const),
      label: { values: [3], exclude: true, match: 'any' as const },
    }
    expect(withoutFilter(filters, 'label')).toEqual({ ...NO_FILTERS, priority: one('high') })
  })
})

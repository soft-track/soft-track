import { describe, expect, it } from 'vitest'

import type { IssueRead } from '@/api/generated/models'
import { filterIssues, NO_FILTERS } from '@/board/filterIssues'

const user = (id: number) => ({
  id,
  email: `u${id}@x.dev`,
  username: `u${id}`,
  full_name: `User ${id}`,
  avatar_color: '#000000',
  is_active: true,
})

const issue = (over: Partial<IssueRead>): IssueRead =>
  ({
    id: 1, team_id: 1, number: 1, identifier: 'ENG-1', title: 't',
    status: 'todo', priority: 'medium', assignee: null, cycle_id: null,
    creator: user(9), labels: [], blocked_by_count: 0, child_count: 0,
    completed_child_count: 0, created_at: '', updated_at: '',
    ...over,
  }) as IssueRead

const ISSUES = [
  issue({ id: 1, priority: 'urgent', assignee: user(1), cycle_id: 10 }),
  issue({ id: 2, priority: 'low', assignee: user(2), cycle_id: 10 }),
  issue({ id: 3, priority: 'urgent', assignee: null, cycle_id: 11 }),
  issue({ id: 4, priority: 'medium', assignee: null, cycle_id: null }),
]
const ids = (list: IssueRead[]) => list.map((i) => i.id)

describe('filterIssues', () => {
  it('passes everything through with no filters', () => {
    expect(ids(filterIssues(ISSUES, NO_FILTERS))).toEqual([1, 2, 3, 4])
  })

  it('narrows by priority', () => {
    expect(ids(filterIssues(ISSUES, { ...NO_FILTERS, priority: 'urgent' }))).toEqual([1, 3])
  })

  it('narrows by cycle', () => {
    expect(ids(filterIssues(ISSUES, { ...NO_FILTERS, cycleId: 10 }))).toEqual([1, 2])
  })

  it('treats "unassigned" as having no assignee, not as a person', () => {
    expect(ids(filterIssues(ISSUES, { ...NO_FILTERS, assignee: 'unassigned' }))).toEqual([3, 4])
  })

  it('narrows to one assignee by id', () => {
    expect(ids(filterIssues(ISSUES, { ...NO_FILTERS, assignee: 2 }))).toEqual([2])
  })

  it('combines filters with AND', () => {
    expect(
      ids(filterIssues(ISSUES, { priority: 'urgent', assignee: 'unassigned', cycleId: 11 })),
    ).toEqual([3])
  })

  it('does not mutate its input', () => {
    const before = [...ISSUES]
    filterIssues(ISSUES, { ...NO_FILTERS, priority: 'low' })
    expect(ISSUES).toEqual(before)
  })
})

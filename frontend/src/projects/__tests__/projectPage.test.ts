import { describe, expect, it } from 'vitest'

import type { IssueRead, StatusRead } from '@/api/generated/models'
import { formatTargetDate, groupByStatus, isOverdue } from '@/projects/projectPage'

function status(id: number, name: string): StatusRead {
  return { id, team_id: 1, name, category: 'unstarted', position: id, color: '#888' }
}

function issue(id: number, on: StatusRead): IssueRead {
  return { id, status: on } as IssueRead
}

const todo = status(1, 'Todo')
const doing = status(2, 'In Progress')
const done = status(3, 'Done')

describe('groupByStatus', () => {
  it('follows the team column order, not the order the issues came in', () => {
    const groups = groupByStatus([todo, doing, done], [issue(1, done), issue(2, todo)])
    expect(groups.map((g) => g.status.name)).toEqual(['Todo', 'Done'])
  })

  it('leaves out columns with nothing in them', () => {
    const groups = groupByStatus([todo, doing, done], [issue(1, doing)])
    expect(groups).toHaveLength(1)
    expect(groups[0].issues.map((i) => i.id)).toEqual([1])
  })

  it('keeps an issue whose status the team list does not know about yet', () => {
    const groups = groupByStatus([todo], [issue(1, todo), issue(2, done)])
    expect(groups.map((g) => g.status.name)).toEqual(['Todo', 'Done'])
  })

  it('is empty for an empty project', () => {
    expect(groupByStatus([todo], [])).toEqual([])
  })
})

describe('isOverdue', () => {
  it('is overdue once the target day has passed and the project is open', () => {
    expect(isOverdue('2026-09-01', 'in_progress', '2026-09-02')).toBe(true)
  })

  it('is not overdue on the target day itself', () => {
    expect(isOverdue('2026-09-02', 'planned', '2026-09-02')).toBe(false)
  })

  it('is never overdue once finished or called off', () => {
    expect(isOverdue('2026-01-01', 'completed', '2026-09-02')).toBe(false)
    expect(isOverdue('2026-01-01', 'cancelled', '2026-09-02')).toBe(false)
  })

  it('is not overdue without a target', () => {
    expect(isOverdue(null, 'in_progress', '2026-09-02')).toBe(false)
  })
})

describe('formatTargetDate', () => {
  it('shows the day that was picked, whatever the viewer timezone', () => {
    expect(formatTargetDate('2026-10-01')).toBe('1 Oct 2026')
  })
})

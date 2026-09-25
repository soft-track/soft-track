import { describe, expect, it } from 'vitest'

import type { IssueRead, ProjectRead, StatusRead } from '@/api/generated/models'
import { groupByStatus, pickableProjects, progressLabel, progressRatio } from '@/team/projects'

function project(id: number, archived: boolean): ProjectRead {
  return {
    id,
    team_id: 1,
    name: `Project ${id}`,
    color: '#6366f1',
    state: 'planned',
    archived,
    created_at: '2026-01-01T00:00:00Z',
    issue_count: 0,
    completed_issue_count: 0,
  }
}

const projects = [project(1, false), project(2, true), project(3, false)]
const ids = (list: ProjectRead[]) => list.map((p) => p.id)

describe('pickableProjects', () => {
  it('leaves archived projects out of a picker', () => {
    expect(ids(pickableProjects(projects))).toEqual([1, 3])
  })

  it('keeps an archived project that is already the selection', () => {
    // Otherwise the dropdown renders blank and the next save clears it.
    expect(ids(pickableProjects(projects, 2))).toEqual([1, 2, 3])
  })

  it('treats a null selection as no selection', () => {
    expect(ids(pickableProjects(projects, null))).toEqual([1, 3])
  })
})

describe('progress', () => {
  const counted = (completed: number, total: number): ProjectRead => ({
    ...project(9, false),
    issue_count: total,
    completed_issue_count: completed,
  })

  it('reads as "n of m done"', () => {
    expect(progressLabel(counted(3, 5))).toBe('3 of 5 done')
    expect(progressRatio(counted(3, 5))).toBeCloseTo(0.6)
  })

  it('says nothing, rather than 0 of 0, for an empty project', () => {
    expect(progressLabel(counted(0, 0))).toBeNull()
    // Not NaN, which a bar would render as no width at all -- or worse.
    expect(progressRatio(counted(0, 0))).toBe(0)
  })
})

describe('groupByStatus', () => {
  const status = (id: number, name: string): StatusRead => ({
    id,
    team_id: 1,
    name,
    category: 'unstarted',
    position: id,
    color: '#888',
  })
  const TODO = status(1, 'Todo')
  const DOING = status(2, 'Doing')
  const DONE = status(3, 'Done')
  const inStatus = (id: number, s: StatusRead) => ({ id, status: s }) as IssueRead

  it('follows board order and leaves empty columns out', () => {
    const groups = groupByStatus(
      [inStatus(1, DONE), inStatus(2, TODO), inStatus(3, DONE)],
      [TODO, DOING, DONE],
    )
    expect(groups.map((group) => group.status.name)).toEqual(['Todo', 'Done'])
    expect(groups[1].issues.map((issue) => issue.id)).toEqual([1, 3])
  })
})

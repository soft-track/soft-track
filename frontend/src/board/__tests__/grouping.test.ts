import { describe, expect, it } from 'vitest'

import type { IssueRead, ProjectRead } from '@/api/generated/models'
import {
  groupByProject,
  groupingFromSearchParams,
  NO_PROJECT_KEY,
  projectForDropTarget,
  withGrouping,
} from '@/board/grouping'
import { NO_FILTERS, toSearchParams } from '@/board/filters'

function project(id: number, name: string, archived = false): ProjectRead {
  return {
    id,
    team_id: 1,
    name,
    color: '#6366f1',
    state: 'planned',
    archived,
    created_at: '2026-01-01T00:00:00Z',
    issue_count: 0,
    completed_issue_count: 0,
  }
}

const issue = (id: number, project_id: number | null) => ({ id, project_id }) as IssueRead
const keys = (groups: ReturnType<typeof groupByProject>) => groups.map((g) => g.key)

describe('the grouping in the URL', () => {
  it('defaults to status, and leaves the default out of the link', () => {
    expect(groupingFromSearchParams(new URLSearchParams(''))).toBe('status')
    expect(withGrouping(new URLSearchParams('priority=urgent'), 'status').toString()).toBe(
      'priority=urgent',
    )
  })

  it('round-trips project grouping beside the filters', () => {
    const params = withGrouping(toSearchParams({ ...NO_FILTERS, projectId: 5 }), 'project')
    expect(params.get('project')).toBe('5')
    expect(params.get('group')).toBe('project')
    expect(groupingFromSearchParams(params)).toBe('project')
  })

  it('reads anything unknown as status rather than failing', () => {
    expect(groupingFromSearchParams(new URLSearchParams('group=assignee'))).toBe('status')
  })

  it('keeps the filter key `project` meaning the filter', () => {
    // A link sent before grouping existed still filters to project 3.
    const params = new URLSearchParams('project=3')
    expect(groupingFromSearchParams(params)).toBe('status')
  })
})

describe('groupByProject', () => {
  const projects = [project(2, 'Zeta'), project(1, 'Alpha'), project(3, 'Retired', true)]

  it('orders projects by name and puts issues in no project last', () => {
    const groups = groupByProject([issue(10, 2), issue(11, null), issue(12, 1)], projects, {
      includeEmpty: false,
    })
    expect(keys(groups)).toEqual(['project:1', 'project:2', NO_PROJECT_KEY])
  })

  it('keeps empty columns on the board, but never for an archived project', () => {
    const groups = groupByProject([], projects, { includeEmpty: true })
    expect(keys(groups)).toEqual(['project:1', 'project:2', NO_PROJECT_KEY])
  })

  it('still shows an archived project that holds some of these issues', () => {
    const groups = groupByProject([issue(10, 3)], projects, { includeEmpty: false })
    expect(keys(groups)).toEqual(['project:3'])
  })

  it('files an issue whose project is unknown under no project, rather than dropping it', () => {
    const groups = groupByProject([issue(10, 99)], projects, { includeEmpty: false })
    expect(groups).toEqual([{ key: NO_PROJECT_KEY, project: null, issues: [issue(10, 99)] }])
  })
})

describe('projectForDropTarget', () => {
  it('reads a project column, the no-project column, and nothing else', () => {
    expect(projectForDropTarget('project:12')).toBe(12)
    expect(projectForDropTarget(NO_PROJECT_KEY)).toBeNull()
    expect(projectForDropTarget('status:4')).toBeUndefined()
  })
})

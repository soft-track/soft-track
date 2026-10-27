import { describe, expect, it } from 'vitest'

import type { TicketRead, ProjectRead, ReleaseRead } from '@/api/generated/models'
import {
  groupByProject,
  groupByRelease,
  groupingFromSearchParams,
  groupTickets,
  NO_PROJECT_KEY,
  NO_RELEASE_KEY,
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
    ticket_count: 0,
    completed_ticket_count: 0,
  }
}

const ticket = (id: number, project_id: number | null) => ({ id, project_id }) as TicketRead
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

  it('orders projects by name and puts tickets in no project last', () => {
    const groups = groupByProject([ticket(10, 2), ticket(11, null), ticket(12, 1)], projects, {
      includeEmpty: false,
    })
    expect(keys(groups)).toEqual(['project:1', 'project:2', NO_PROJECT_KEY])
  })

  it('keeps empty columns on the board, but never for an archived project', () => {
    const groups = groupByProject([], projects, { includeEmpty: true })
    expect(keys(groups)).toEqual(['project:1', 'project:2', NO_PROJECT_KEY])
  })

  it('still shows an archived project that holds some of these tickets', () => {
    const groups = groupByProject([ticket(10, 3)], projects, { includeEmpty: false })
    expect(keys(groups)).toEqual(['project:3'])
  })

  it('files a ticket whose project is unknown under no project, rather than dropping it', () => {
    const groups = groupByProject([ticket(10, 99)], projects, { includeEmpty: false })
    expect(groups).toEqual([{ key: NO_PROJECT_KEY, project: null, tickets: [ticket(10, 99)] }])
  })
})

describe('projectForDropTarget', () => {
  it('reads a project column, the no-project column, and nothing else', () => {
    expect(projectForDropTarget('project:12')).toBe(12)
    expect(projectForDropTarget(NO_PROJECT_KEY)).toBeNull()
    expect(projectForDropTarget('status:4')).toBeUndefined()
  })
})

describe('grouping by release (#272)', () => {
  const release = (id: number, name: string, state: ReleaseRead['state'] = 'planned') =>
    ({
      id,
      team_id: 1,
      name,
      state,
      created_at: '2026-01-01T00:00:00Z',
      progress: {
        tickets_total: 0,
        tickets_done: 0,
        points_total: 0,
        points_done: 0,
        tickets_unestimated: 0,
      },
    }) as ReleaseRead
  const releases = [release(4, '1.4.0'), release(3, '1.3.2', 'released'), release(1, '0.9', 'archived')]
  const shipping = (id: number, fix_version_id: number | null) =>
    ({ id, fix_version_id }) as TicketRead

  it('reads and writes the grouping in the link', () => {
    const params = withGrouping(new URLSearchParams(''), 'release')
    expect(params.toString()).toBe('group=release')
    expect(groupingFromSearchParams(params)).toBe('release')
  })

  it('keeps the team’s order of releases, and tickets in none last', () => {
    const groups = groupByRelease(
      [shipping(10, 3), shipping(11, null), shipping(12, 4)],
      releases,
      { includeEmpty: false },
    )
    expect(groups.map((group) => group.key)).toEqual(['release:4', 'release:3', NO_RELEASE_KEY])
  })

  it('offers an empty column to drop into on the board, but never an archived one', () => {
    const groups = groupByRelease([], releases, { includeEmpty: true })
    expect(groups.map((group) => group.key)).toEqual(['release:4', 'release:3', NO_RELEASE_KEY])
    // Still holding a ticket, an archived release keeps its column.
    expect(
      groupByRelease([shipping(10, 1)], releases, { includeEmpty: true }).map((g) => g.key),
    ).toContain('release:1')
  })

  it('says what a drop on each column changes', () => {
    const groups = groupTickets('release', [shipping(10, 4)], { projects: [], releases }, {
      includeEmpty: true,
    })
    expect(groups.map((group) => [group.name, group.change])).toEqual([
      ['1.4.0', { fix_version_id: 4 }],
      ['1.3.2', { fix_version_id: 3 }],
      [null, { fix_version_id: null }],
    ])
  })
})

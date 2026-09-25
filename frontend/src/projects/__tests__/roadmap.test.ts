import { describe, expect, it } from 'vitest'

import type { ProjectRead } from '@/api/generated/models'
import { isOverdue, roadmapSections } from '@/projects/roadmap'

const TODAY = '2026-09-25'

function project(
  id: number,
  name: string,
  target_date: string | null,
  fields: Partial<ProjectRead> = {},
): ProjectRead {
  return {
    id,
    team_id: 1,
    name,
    color: '#6366f1',
    target_date,
    state: 'in_progress',
    archived: false,
    created_at: '2026-01-01T00:00:00Z',
    issue_count: 0,
    completed_issue_count: 0,
    ...fields,
  }
}

const names = (list: ProjectRead[]) => list.map((p) => p.name)

describe('roadmapSections', () => {
  it('groups by month in date order, skipping months with nothing due', () => {
    const sections = roadmapSections(
      [
        project(1, 'Billing', '2026-12-10'),
        project(2, 'Search', '2026-10-30'),
        project(3, 'Auth', '2026-10-02'),
      ],
      TODAY,
    )
    expect(sections.map((s) => s.title)).toEqual(['October 2026', 'December 2026'])
    // Within a month, by day.
    expect(names(sections[0].projects)).toEqual(['Auth', 'Search'])
  })

  it('lists undated projects last, in their own section, rather than dropping them', () => {
    const sections = roadmapSections(
      [project(1, 'Zed', null), project(2, 'Dated', '2026-11-01'), project(3, 'Alpha', null)],
      TODAY,
    )
    expect(sections.map((s) => s.key)).toEqual(['2026-11', 'undated'])
    expect(names(sections[1].projects)).toEqual(['Alpha', 'Zed'])
  })

  it('leaves archived projects out', () => {
    const sections = roadmapSections(
      [project(1, 'Retired', '2026-11-01', { archived: true }), project(2, 'Live', '2026-11-02')],
      TODAY,
    )
    expect(names(sections.flatMap((s) => s.projects))).toEqual(['Live'])
  })

  it('marks the current month', () => {
    const sections = roadmapSections(
      [project(1, 'Now', '2026-09-30'), project(2, 'Later', '2026-10-01')],
      TODAY,
    )
    expect(sections.map((s) => s.isCurrentMonth)).toEqual([true, false])
  })

  it('is empty for a team with no live projects', () => {
    expect(roadmapSections([], TODAY)).toEqual([])
  })
})

describe('isOverdue', () => {
  it('is past the date and still open', () => {
    expect(isOverdue(project(1, 'Late', '2026-09-24'), TODAY)).toBe(true)
    // Due today is not late yet.
    expect(isOverdue(project(1, 'Today', TODAY), TODAY)).toBe(false)
  })

  it('never applies to a project that has landed or stopped, or has no date', () => {
    expect(isOverdue(project(1, 'Done', '2026-01-01', { state: 'completed' }), TODAY)).toBe(false)
    expect(isOverdue(project(1, 'Stop', '2026-01-01', { state: 'cancelled' }), TODAY)).toBe(false)
    expect(isOverdue(project(1, 'None', null), TODAY)).toBe(false)
  })
})

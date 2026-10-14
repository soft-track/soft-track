import { describe, expect, it } from 'vitest'

import type { ProjectRead, ReleaseRead } from '@/api/generated/models'
import { isOverdue, releaseDay, roadmapSections } from '@/projects/roadmap'

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
    ticket_count: 0,
    completed_ticket_count: 0,
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

describe('releases on the roadmap (#272)', () => {
  const release = (
    id: number,
    name: string,
    fields: Partial<ReleaseRead> = {},
  ): ReleaseRead => ({
    id,
    team_id: 1,
    name,
    state: 'planned',
    created_at: '2026-01-01T00:00:00Z',
    progress: {
      tickets_total: 0,
      tickets_done: 0,
      points_total: 0,
      points_done: 0,
      tickets_unestimated: 0,
    },
    ...fields,
  })

  it('marks each release in the month of its day, the day it shipped first', () => {
    const sections = roadmapSections(
      [project(1, 'Portal', '2026-10-30')],
      TODAY,
      [
        release(4, '1.4.0', { target_date: '2026-10-15' }),
        release(3, '1.3.2', {
          state: 'released',
          target_date: '2026-08-30',
          released_on: '2026-09-03',
        }),
        // No day yet, and put away: neither is on a calendar.
        release(5, '1.5.0'),
        release(1, '0.9', { state: 'archived', released_on: '2026-10-01' }),
      ],
    )
    expect(sections.map((section) => [section.key, section.releases.map((r) => r.name)])).toEqual([
      ['2026-09', ['1.3.2']],
      ['2026-10', ['1.4.0']],
    ])
    // A month can hold a release and no epic.
    expect(sections[0].projects).toEqual([])
  })

  it('says which day it is marked on', () => {
    expect(releaseDay(release(4, '1.4.0', { target_date: '2026-10-15' }))).toBe('2026-10-15')
    expect(releaseDay(release(4, '1.4.0'))).toBeNull()
  })
})

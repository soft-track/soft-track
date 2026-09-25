// @vitest-environment jsdom
/**
 * The roadmap (issue #62): what is due when, and each row one click from its
 * project's page.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import type { ProjectRead } from '@/api/generated/models'
import { RoadmapView } from '@/projects/RoadmapView'
import { TeamProvider } from '@/team/TeamContext'
import type { TeamContextValue } from '@/team/useTeamContext'

function project(id: number, name: string, fields: Partial<ProjectRead> = {}): ProjectRead {
  return {
    id,
    team_id: 7,
    name,
    color: '#6366f1',
    target_date: null,
    state: 'planned',
    archived: false,
    created_at: '2026-01-01T00:00:00Z',
    issue_count: 0,
    completed_issue_count: 0,
    ...fields,
  }
}

function renderRoadmap(projects: ProjectRead[]) {
  const team: TeamContextValue = {
    team: { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' },
    teams: [],
    projects,
    labels: [],
    members: [],
    cycles: [],
    statuses: [],
  }
  render(
    <TeamProvider value={team}>
      <MemoryRouter initialEntries={['/ENG']}>
        <Routes>
          <Route path="/ENG" element={<RoadmapView today="2026-09-25" />} />
          <Route path="/ENG/projects/:id" element={<p>Opened a project page</p>} />
        </Routes>
      </MemoryRouter>
    </TeamProvider>,
  )
  return userEvent.setup()
}

afterEach(cleanup)

describe('the roadmap', () => {
  it('shows each project under its month with state and progress', () => {
    renderRoadmap([
      project(1, 'Billing', {
        target_date: '2026-11-14',
        state: 'in_progress',
        issue_count: 4,
        completed_issue_count: 1,
      }),
    ])
    const november = screen.getByRole('region', { name: 'November 2026' })
    expect(within(november).getByText('Billing')).toBeTruthy()
    expect(within(november).getByText('In progress')).toBeTruthy()
    expect(within(november).getByText('1 of 4 done')).toBeTruthy()
    expect(within(november).getByText('14 Nov')).toBeTruthy()
  })

  it('calls out an open project past its date', () => {
    renderRoadmap([project(1, 'Late', { target_date: '2026-09-01', state: 'in_progress' })])
    expect(screen.getByText('Overdue')).toBeTruthy()
  })

  it('keeps undated projects visible, and says how many there are', () => {
    renderRoadmap([project(1, 'Someday'), project(2, 'Dated', { target_date: '2026-10-01' })])
    expect(screen.getByText(/1 project has no target date/)).toBeTruthy()
    const undated = screen.getByRole('region', { name: 'No target date' })
    expect(within(undated).getByText('Someday')).toBeTruthy()
  })

  it('opens the project page from a row', async () => {
    const user = renderRoadmap([project(3, 'Billing', { target_date: '2026-11-14' })])
    await user.click(screen.getByRole('link', { name: /Billing/ }))
    expect(screen.getByText('Opened a project page')).toBeTruthy()
  })

  it('says where projects will appear on an empty team', () => {
    renderRoadmap([])
    expect(screen.getByText('No projects on Engineering yet.')).toBeTruthy()
  })
})

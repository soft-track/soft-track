// @vitest-environment jsdom
/**
 * The frame around the people pages (#125): the board's sidebar, for the
 * team whose board was open last, whose rows open that team's board.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Sidebar } from '@/board/Sidebar'
import { NO_FILTERS } from '@/board/filters'
import PeopleLayout from '@/people/PeopleLayout'
import { rememberTeam } from '@/team/lastTeam'
import { useTeamContext } from '@/team/useTeamContext'

const mocks = vi.hoisted(() => ({
  teams: [] as { id: number; key: string; name: string }[],
  sidebar: null as unknown,
}))

vi.mock('@/team/useTeams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/team/useTeams')>()),
  useTeamByKey: (key: string | undefined) => ({
    team: mocks.teams.find((team) => team.key === key),
    teams: mocks.teams,
    isLoading: false,
    isError: false,
  }),
}))

vi.mock('@/team/useTeamData', () => ({
  useTeamData: () => ({
    projects: [],
    labels: [],
    members: [],
    sprints: [],
    statuses: [],
    estimates: undefined,
  }),
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: { id: 1 } }),
}))

vi.mock('@/board/Sidebar', () => ({
  Sidebar: function StubSidebar(props: unknown) {
    mocks.sidebar = props
    return <p>Sidebar of {useTeamContext().team.key}</p>
  },
}))

type SidebarProps = ComponentProps<typeof Sidebar>
const sidebarProps = () => mocks.sidebar as SidebarProps

const ENG = { id: 1, key: 'ENG', name: 'Engineering' }
const OPS = { id: 2, key: 'OPS', name: 'Operations' }

function Where() {
  const location = useLocation()
  return <output data-testid="where">{location.pathname + location.search}</output>
}

function renderLayout() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/people']}>
        <Routes>
          <Route path="/people" element={<PeopleLayout />}>
            <Route index element={<p>The directory</p>} />
          </Route>
          <Route path="/:teamKey" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  mocks.teams = [ENG, OPS]
  mocks.sidebar = null
})

afterEach(() => {
  cleanup()
})

describe('The people pages’ frame', () => {
  it('shows the sidebar of the team whose board was open last', () => {
    rememberTeam('OPS')
    renderLayout()
    expect(screen.getAllByText('Sidebar of OPS').length).toBeGreaterThan(0)
    expect(screen.getByText('The directory')).toBeTruthy()
  })

  it('falls back to the first team', () => {
    renderLayout()
    expect(screen.getAllByText('Sidebar of ENG').length).toBeGreaterThan(0)
  })

  it('marks nothing in the sidebar as showing', () => {
    renderLayout()
    expect(sidebarProps().filters).toBeNull()
    // Nor is there a dialog here to rename a view in.
    expect(sidebarProps().onEditView).toBeUndefined()
  })

  it('opens the team’s board with whatever the sidebar picked', () => {
    renderLayout()
    act(() => sidebarProps().onFiltersChange({ ...NO_FILTERS, sprintId: 3 }))
    expect(screen.getByTestId('where').textContent).toBe('/ENG?sprint=3')
  })

  it('brings a saved view’s grouping and sort along', () => {
    renderLayout()
    act(() =>
      sidebarProps().onFiltersChange(
        { ...NO_FILTERS, priority: 'urgent' },
        { grouping: 'project', sort: { sort: 'priority', direction: 'desc' } },
      ),
    )
    expect(screen.getByTestId('where').textContent).toBe(
      '/ENG?priority=urgent&group=project&sort=priority&dir=desc',
    )
  })

  it('stands on its own for somebody on no team yet', () => {
    mocks.teams = []
    renderLayout()
    expect(screen.getByText('The directory')).toBeTruthy()
    expect(screen.queryByText(/Sidebar of/)).toBeNull()
  })
})

// @vitest-environment jsdom
/**
 * "New team" in the sidebar is for whoever may create one (#306): gone on an
 * instance that leaves it to site admins or named people, and never there
 * for an account from outside the organisation.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Sidebar } from '@/board/Sidebar'
import { NO_FILTERS } from '@/board/filters'

const mocks = vi.hoisted(() => ({
  user: { id: 1, full_name: 'Tomas Silva', avatar_color: '#123', is_external: false },
  mayCreate: true,
  current: 1,
}))

const TEAMS = [
  { id: 1, key: 'ENG', name: 'Engineering', archived_at: null },
  { id: 2, key: 'OLD', name: 'Old site', archived_at: '2026-09-30T10:00:00Z' },
  { id: 3, key: 'OPS', name: 'Operations', archived_at: null },
]

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: mocks.user, logout: vi.fn() }),
}))
vi.mock('@/team/useTeams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/team/useTeams')>()),
  useTeamCreation: () => ({ mayCreate: mocks.mayCreate }),
}))
vi.mock('@/team/useTeamContext', () => ({
  useTeamContext: () => ({
    team: TEAMS.find((team) => team.id === mocks.current),
    teams: TEAMS,
    projects: [],
    sprints: [],
  }),
}))
vi.mock('@/ui/theme', () => ({ useTheme: () => ({ theme: 'light', toggle: () => {} }) }))
vi.mock('@/views/ViewList', () => ({ ViewList: () => null }))
vi.mock('@/sprints/SprintList', () => ({ SprintList: () => null }))
vi.mock('@/team/InvitesBanner', () => ({ InvitesBanner: () => null }))
vi.mock('@/mywork/MyWorkNavItem', () => ({ MyWorkNavItem: () => null }))

function renderSidebar() {
  render(
    <MemoryRouter>
      <Sidebar
        filters={NO_FILTERS}
        arrangement={{ grouping: 'status', sort: null } as never}
        onFiltersChange={() => {}}
        isAdmin={false}
      />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mocks.user = { id: 1, full_name: 'Tomas Silva', avatar_color: '#123', is_external: false }
  mocks.mayCreate = true
  mocks.current = 1
})

afterEach(() => {
  cleanup()
})

describe('Sidebar, New team', () => {
  it('is there for somebody who may create a team', () => {
    renderSidebar()
    expect(screen.getByRole('link', { name: 'New team' }).getAttribute('href')).toBe('/new-team')
  })

  it('leaves where creating one is restricted', () => {
    mocks.mayCreate = false
    renderSidebar()
    expect(screen.queryByRole('link', { name: 'New team' })).toBeNull()
  })

  it('is never there for an account from outside', () => {
    mocks.user = { ...mocks.user, is_external: true }
    renderSidebar()
    expect(screen.queryByRole('link', { name: 'New team' })).toBeNull()
  })
})

describe('Sidebar, the team switcher (#322)', () => {
  const options = () =>
    Array.from(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Team' }).options).map(
      (option) => option.textContent,
    )

  it('leaves an archived team out', () => {
    renderSidebar()
    expect(options()).toEqual(['Engineering · ENG', 'Operations · OPS'])
  })

  it('keeps the archived team that is open, marked', () => {
    mocks.current = 2
    renderSidebar()
    expect(options()).toEqual([
      'Engineering · ENG',
      'Old site · OLD (archived)',
      'Operations · OPS',
    ])
  })
})

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
}))

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
    team: { id: 1, key: 'ENG', name: 'Engineering' },
    teams: [{ id: 1, key: 'ENG', name: 'Engineering' }],
    projects: [],
    sprints: [],
  }),
}))
vi.mock('@/ui/theme', () => ({ useTheme: () => ({ theme: 'light', toggle: () => {} }) }))
vi.mock('@/views/ViewList', () => ({ ViewList: () => null }))
vi.mock('@/sprints/SprintList', () => ({ SprintList: () => null }))
vi.mock('@/team/InvitesBanner', () => ({ InvitesBanner: () => null }))

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

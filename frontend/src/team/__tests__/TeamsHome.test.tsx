// @vitest-environment jsdom
/**
 * The first page for an account on no team (#318): what it can reach without
 * one, the teams there are and who runs them, and creating a team as one
 * option rather than the whole page.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TeamsHome from '@/team/TeamsHome'

const person = (id: number, full_name: string) => ({
  id,
  email: `${id}@example.com`,
  username: `u${id}`,
  full_name,
  avatar_color: '#123',
  is_active: true,
})

const mocks = vi.hoisted(() => ({
  user: { full_name: 'Yuki Tanaka', is_finance_admin: false },
  teams: [] as unknown[],
  directory: [] as unknown[],
  invites: [] as unknown[],
  logout: vi.fn(),
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: mocks.user, logout: mocks.logout }),
}))
vi.mock('@/team/useTeams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/team/useTeams')>()),
  useMyTeams: () => ({ data: mocks.teams, isLoading: false }),
}))
vi.mock('@/api/generated/endpoints/teams/teams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/teams/teams')>()),
  useTeamDirectoryTeamsDirectoryGet: () => ({
    data: mocks.directory,
    isPending: false,
    isSuccess: true,
  }),
}))
vi.mock('@/api/generated/endpoints/auth/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/auth/auth')>()),
  useMyInvitesAuthMeInvitesGet: () => ({ data: mocks.invites, isPending: false }),
}))
vi.mock('@/team/InvitesBanner', () => ({
  InvitesBanner: () => <p>Your invitations</p>,
}))

function renderHome() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<TeamsHome />} />
          <Route path="/:teamKey" element={<p>Board</p>} />
          <Route path="/new-team" element={<p>New team form</p>} />
          <Route path="/people" element={<p>Directory</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const ENGINEERING = {
  id: 1,
  name: 'Engineering',
  key: 'ENG',
  description: null,
  member_count: 8,
  admins: [person(1, 'Amina Khan'), person(2, 'Demo User')],
}
const SUPPORT = {
  id: 2,
  name: 'Support',
  key: 'SUP',
  description: null,
  member_count: 1,
  admins: [person(3, 'Nina Petrova')],
}

beforeEach(() => {
  mocks.user = { full_name: 'Yuki Tanaka', is_finance_admin: false }
  mocks.teams = []
  mocks.directory = [ENGINEERING, SUPPORT]
  mocks.invites = []
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TeamsHome with no team', () => {
  it('goes to the first board when there is a team', () => {
    mocks.teams = [{ id: 1, key: 'ENG', name: 'Engineering' }]
    renderHome()
    expect(screen.getByText('Board')).toBeTruthy()
  })

  it('offers what the sidebar would have, not a form for a new team', () => {
    renderHome()
    expect(screen.getByRole('heading', { name: 'Welcome, Yuki' })).toBeTruthy()
    expect(screen.queryByLabelText('Team name')).toBeNull()
    const links = screen
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')])
    expect(links).toEqual(
      expect.arrayContaining([
        [expect.stringContaining('People'), '/people'],
        [expect.stringContaining('Your profile'), '/settings/profile'],
        [expect.stringContaining('Your expenses'), '/settings/expenses'],
      ]),
    )
    expect(screen.queryByRole('link', { name: /Finance/ })).toBeNull()
  })

  it('adds Finance for a finance admin', () => {
    mocks.user = { full_name: 'Omar Haddad', is_finance_admin: true }
    renderHome()
    expect(screen.getByRole('link', { name: /Finance/ }).getAttribute('href')).toBe(
      '/settings/finance',
    )
  })

  it('names the teams there are and who to ask', () => {
    renderHome()
    const list = screen.getByRole('region', { name: 'Teams you can ask to join' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([
      'ENGEngineering8 people · admins Amina Khan and Demo User',
      'SUPSupport1 person · admin Nina Petrova',
    ])
  })

  it('keeps creating a team as one option', async () => {
    const user = renderHome()
    await user.click(screen.getByRole('link', { name: 'Create a team' }))
    expect(screen.getByText('New team form')).toBeTruthy()
  })

  it('puts creating the first team up front on an instance with none', () => {
    mocks.directory = []
    renderHome()
    expect(screen.getByText('There are no teams on this SoftTrack yet.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Create the first team' }).getAttribute('href')).toBe(
      '/new-team',
    )
    expect(screen.queryByRole('link', { name: 'Create a team' })).toBeNull()
  })

  it('leads with invitations when there are any', () => {
    mocks.invites = [{ id: 1 }]
    renderHome()
    expect(screen.getByText('Your invitations')).toBeTruthy()
    expect(
      screen.getByText('You have been invited to a team. Accept to start, or look around first.'),
    ).toBeTruthy()
    // Still the rest of the page around them.
    expect(screen.getByRole('link', { name: /People/ })).toBeTruthy()
  })

  it('signs out', async () => {
    const user = renderHome()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(mocks.logout).toHaveBeenCalled()
  })
})

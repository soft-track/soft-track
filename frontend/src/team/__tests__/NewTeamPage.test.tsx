// @vitest-environment jsdom
/**
 * Creating a team lands on its board (found by the e2e suite, #92).
 *
 * The board looks its team up in the cached team list, which stays fresh for
 * 30 seconds. Unless the new team is put there first, a new account's empty
 * list sends it straight back to this page.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getListMyTeamsTeamsGetQueryKey } from '@/api/generated/endpoints/teams/teams'
import NewTeamPage from '@/team/NewTeamPage'

const TEAM = { id: 3, name: 'Platform', key: 'PLAT', created_at: '2026-09-26T09:00:00Z' }

const create = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }))
const creation = vi.hoisted(() => ({ current: undefined as unknown }))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: { full_name: 'Grace Hopper' }, logout: vi.fn() }),
}))
vi.mock('@/api/generated/endpoints/teams/teams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/teams/teams')>()),
  useCreateTeamTeamsPost: () => create,
  useTeamCreationAccessTeamsCreationGet: () =>
    creation.current ? { data: creation.current, isSuccess: true } : { isPending: true },
  useRequestTeamTeamsRequestsPost: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

afterEach(() => {
  creation.current = undefined
  cleanup()
  vi.restoreAllMocks()
})

describe('NewTeamPage', () => {
  it('puts the new team in the cached list before going to its board', async () => {
    create.mutateAsync.mockResolvedValue(TEAM)
    const queryClient = new QueryClient()
    // What a brand-new account has cached: no teams at all.
    queryClient.setQueryData(getListMyTeamsTeamsGetQueryKey(), [])
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/new-team']}>
          <Routes>
            <Route path="/new-team" element={<NewTeamPage />} />
            <Route path="/:teamKey" element={<p>Board</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Team name'), 'Platform')
    await user.type(screen.getByLabelText(/^Key/), 'plat')
    await user.click(screen.getByRole('button', { name: 'Create team' }))

    expect(await screen.findByText('Board')).toBeTruthy()
    expect(queryClient.getQueryData(getListMyTeamsTeamsGetQueryKey())).toEqual([TEAM])
  })
})

describe('NewTeamPage where creating a team is left to some (#306)', () => {
  it('gives way to who to ask, and asking', () => {
    creation.current = {
      may_create: false,
      policy: 'named_people',
      site_admins: [{ id: 1, full_name: 'Demo User', avatar_color: '#123' }],
      pending_requests: [],
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/new-team']}>
          <Routes>
            <Route path="/new-team" element={<NewTeamPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.queryByLabelText('Team name')).toBeNull()
    expect(
      screen.getByText('Teams are created by site admins and a few named people here'),
    ).toBeTruthy()
    expect(screen.getByText('Ask Demo User, or ask for a team of your own.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ask for a team' })).toBeTruthy()
  })
})

describe('NewTeamPage, a key that stays taken (#322)', () => {
  it('says so under the Key field, in the mockup’s words', async () => {
    create.mutateAsync.mockRejectedValue({
      response: { status: 400, data: { code: 'team_key_archived', detail: 'x' } },
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/new-team']}>
          <Routes>
            <Route path="/new-team" element={<NewTeamPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Team name'), 'Engineering')
    await user.type(screen.getByLabelText(/^Key/), 'eng')
    await user.click(screen.getByRole('button', { name: 'Create team' }))

    const message = await screen.findByText(
      'ENG belongs to an archived team, and a key is never given back.',
    )
    const key = screen.getByLabelText(/^Key/)
    expect(key.getAttribute('aria-invalid')).toBe('true')
    expect(key.getAttribute('aria-describedby')).toBe(message.id)
    // Under the field, not above the form.
    expect(key.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.type(key, 'X')
    expect(screen.queryByText(/belongs to an archived team/)).toBeNull()
  })
})

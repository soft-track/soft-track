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

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: { full_name: 'Grace Hopper' }, logout: vi.fn() }),
}))
vi.mock('@/api/generated/endpoints/teams/teams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/teams/teams')>()),
  useCreateTeamTeamsPost: () => create,
}))

afterEach(() => {
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

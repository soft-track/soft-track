// @vitest-environment jsdom
/**
 * "Who can find this team" under a team's General settings (#259): listed
 * in Teams by default, open to join only when an admin turns it on.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TeamGeneralSettings from '@/settings/TeamGeneralSettings'

const AMINA = {
  id: 10,
  email: 'amina@x.dev',
  username: 'amina',
  full_name: 'Amina Khan',
  avatar_color: '#123',
  is_active: true,
}

const mocks = vi.hoisted(() => ({ role: 'admin' as string, update: vi.fn() }))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: AMINA }),
}))
vi.mock('@/team/useTeams', async (importOriginal) => {
  const team = {
    id: 7,
    name: 'Engineering',
    key: 'ENG',
    created_at: '2026-01-01T00:00:00Z',
    listed: true,
    open_to_join: false,
  }
  return {
    ...(await importOriginal<typeof import('@/team/useTeams')>()),
    useTeamByKey: () => ({ team, isLoading: false, isError: false, teams: [team] }),
  }
})
vi.mock('@/api/generated/endpoints/teams/teams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/teams/teams')>()),
  useListTeamMembersTeamsTeamIdMembersGet: () => ({
    data: [{ role: mocks.role, joined_at: '2026-01-01T00:00:00Z', user: AMINA }],
  }),
  useUpdateTeamTeamsTeamIdPatch: () => ({ mutateAsync: mocks.update, isPending: false }),
}))

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/settings/teams/ENG/general']}>
        <Routes>
          <Route path="/settings/teams/:teamKey/general" element={<TeamGeneralSettings />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const listed = () => screen.getByRole<HTMLInputElement>('switch', { name: /Listed in Teams/ })
const open = () => screen.getByRole<HTMLInputElement>('switch', { name: /Open to join/ })

beforeEach(() => {
  mocks.role = 'admin'
  mocks.update.mockReset().mockResolvedValue({})
})

afterEach(() => {
  cleanup()
})

describe('Who can find this team', () => {
  it('is listed and closed to begin with, and says what each means', () => {
    renderPage()
    expect(screen.getByText('Who can find this team')).toBeTruthy()
    expect(listed().checked).toBe(true)
    expect(open().checked).toBe(false)
    expect(
      screen.getByText('People who are not members see the name, the key and the admins.'),
    ).toBeTruthy()
    expect(screen.getByText('Anybody signed in joins as a member without asking.')).toBeTruthy()
  })

  it('saves each switch as it is turned', async () => {
    const user = renderPage()
    await user.click(listed())
    expect(mocks.update).toHaveBeenCalledWith({ teamId: 7, data: { listed: false } })
    await user.click(open())
    expect(mocks.update).toHaveBeenCalledWith({ teamId: 7, data: { open_to_join: true } })
  })

  it('switches back when saving fails', async () => {
    mocks.update.mockRejectedValue(new Error('nope'))
    const user = renderPage()
    await user.click(open())
    await waitFor(() => expect(open().checked).toBe(false))
    expect(screen.getByRole('alert').textContent).toBe('Could not change who can find this team.')
  })

  it('is only an admin’s to change', () => {
    mocks.role = 'member'
    renderPage()
    expect(listed().disabled).toBe(true)
    expect(open().disabled).toBe(true)
  })
})

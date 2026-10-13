// @vitest-environment jsdom
/**
 * "Guests may comment" under a team's General settings (#244): off by
 * default, an admin's switch, and the team's guests named beneath it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TeamGeneralSettings from '@/settings/TeamGeneralSettings'

const person = (id: number, full_name: string) => ({
  id,
  email: `${id}@x.dev`,
  username: `u${id}`,
  full_name,
  avatar_color: '#123',
  is_active: true,
})
const AMINA = person(10, 'Amina Khan')

const mocks = vi.hoisted(() => ({
  role: 'admin' as string,
  guests: [] as { id: number; full_name: string }[],
  on: false,
  update: vi.fn(),
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: AMINA }),
}))
vi.mock('@/team/useTeams', async (importOriginal) => {
  const team = () => ({
    id: 7,
    name: 'Engineering',
    key: 'ENG',
    created_at: '2026-01-01T00:00:00Z',
    any_member_may_delete: false,
    guests_may_comment: mocks.on,
  })
  return {
    ...(await importOriginal<typeof import('@/team/useTeams')>()),
    useTeamByKey: () => ({ team: team(), isLoading: false, isError: false, teams: [team()] }),
  }
})
vi.mock('@/api/generated/endpoints/teams/teams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/teams/teams')>()),
  useListTeamMembersTeamsTeamIdMembersGet: () => ({
    data: [
      { role: mocks.role, joined_at: '2026-01-01T00:00:00Z', user: AMINA },
      ...mocks.guests.map((guest) => ({
        role: 'guest',
        joined_at: '2026-01-02T00:00:00Z',
        user: person(guest.id, guest.full_name),
      })),
    ],
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

const toggle = () => screen.getByRole<HTMLInputElement>('switch', { name: /Guests may comment/ })

beforeEach(() => {
  mocks.role = 'admin'
  mocks.on = false
  mocks.guests = [
    { id: 21, full_name: 'Sofia Marin' },
    { id: 22, full_name: 'Carlos Rivera' },
  ]
  mocks.update.mockReset().mockResolvedValue({})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('guests may comment', () => {
  it('is off, and names the guests it would let in', () => {
    renderPage()
    expect(toggle().checked).toBe(false)
    expect(screen.getByText('Engineering has 2 guests: Sofia Marin and Carlos Rivera.')).toBeTruthy()
  })

  it('lets an admin turn it on, saved at once', async () => {
    const user = renderPage()
    await user.click(toggle())
    expect(mocks.update).toHaveBeenCalledWith({ teamId: 7, data: { guests_may_comment: true } })
    expect(toggle().checked).toBe(true)
  })

  it('switches back when the change is refused', async () => {
    mocks.update.mockRejectedValue({ response: { data: { detail: 'Only team admins can do that' } } })
    const user = renderPage()
    await user.click(toggle())
    await waitFor(() => expect(toggle().checked).toBe(false))
    expect(screen.getByRole('alert').textContent).toBe('Only team admins can do that')
  })

  it('shows a member the setting without the switch working', () => {
    mocks.role = 'member'
    mocks.on = true
    mocks.guests = []
    renderPage()
    expect(toggle().checked).toBe(true)
    expect(toggle().disabled).toBe(true)
    expect(screen.getByText('Engineering has no guests.')).toBeTruthy()
  })
})

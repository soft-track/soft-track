// @vitest-environment jsdom
/**
 * What a team estimates in (#268), under its General settings: points,
 * hours or both, with points the default. An admin's to change.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TeamGeneralSettings from '@/settings/TeamGeneralSettings'

const AMINA = { id: 10, email: 'a@x.dev', username: 'amina', full_name: 'Amina Khan', avatar_color: '#123', is_active: true }

const mocks = vi.hoisted(() => ({
  role: 'admin' as string,
  anyMember: false,
  unit: undefined as string | undefined,
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
    any_member_may_delete: mocks.anyMember,
    estimate_unit: mocks.unit,
  })
  return {
    ...(await importOriginal<typeof import('@/team/useTeams')>()),
    useTeamByKey: () => ({ team: team(), isLoading: false, isError: false, teams: [team()] }),
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

const choice = (name: RegExp) => screen.getByRole<HTMLInputElement>('radio', { name })

beforeEach(() => {
  mocks.role = 'admin'
  mocks.anyMember = false
  mocks.unit = undefined
  mocks.update.mockReset().mockResolvedValue({})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('what a team estimates in', () => {
  it('is points until somebody chooses', () => {
    renderPage()
    expect(screen.getByRole('group', { name: 'This team estimates in' })).toBeTruthy()
    expect(choice(/^Points/).checked).toBe(true)
    expect(screen.getByText('The default. A team that leaves it sees no change.')).toBeTruthy()
  })

  it('saves a choice as soon as it is made', async () => {
    const user = renderPage()
    await user.click(choice(/^Both/))
    expect(mocks.update).toHaveBeenCalledWith({ teamId: 7, data: { estimate_unit: 'both' } })
    expect(choice(/^Both/).checked).toBe(true)
  })

  it('goes back and says so when the save fails', async () => {
    mocks.unit = 'hours'
    mocks.update.mockRejectedValue(new Error('nope'))
    const user = renderPage()
    await user.click(choice(/^Points/))
    await waitFor(() =>
      expect(screen.getByText('Could not change what this team estimates in.')).toBeTruthy(),
    )
    expect(choice(/^Hours/).checked).toBe(true)
  })

  it('is not a member’s to change', () => {
    mocks.role = 'member'
    renderPage()
    expect(choice(/^Hours/).disabled).toBe(true)
  })
})

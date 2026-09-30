// @vitest-environment jsdom
/**
 * Who may delete tickets and epics (#323), under a team's General settings:
 * their creator and the team's admins, or every member. An admin's to change.
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
  mocks.update.mockReset().mockResolvedValue({})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('who may delete', () => {
  it('shows the team’s choice', () => {
    renderPage()
    expect(screen.getByRole('group', { name: 'Who may delete tickets and epics' })).toBeTruthy()
    expect(choice(/The creator and team admins/).checked).toBe(true)
    expect(choice(/Every member/).checked).toBe(false)
  })

  it('lets an admin change it, saved at once', async () => {
    const user = renderPage()
    await user.click(choice(/Every member/))
    expect(mocks.update).toHaveBeenCalledWith({
      teamId: 7,
      data: { any_member_may_delete: true },
    })
    expect(choice(/Every member/).checked).toBe(true)
  })

  it('puts it back when the change is refused', async () => {
    mocks.update.mockRejectedValue({
      response: { data: { code: 'not_team_admin', detail: 'Only team admins can do that' } },
    })
    const user = renderPage()
    await user.click(choice(/Every member/))
    await waitFor(() => expect(choice(/The creator and team admins/).checked).toBe(true))
    expect(screen.getByRole('alert').textContent).toBeTruthy()
  })

  it('shows a member the rule without letting them change it', () => {
    mocks.role = 'member'
    mocks.anyMember = true
    renderPage()
    expect(choice(/Every member/).checked).toBe(true)
    expect(choice(/Every member/).disabled).toBe(true)
    expect(choice(/The creator and team admins/).disabled).toBe(true)
  })
})

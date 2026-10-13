// @vitest-environment jsdom
/**
 * Inviting somebody from outside the organisation, and the epics they see
 * (#243): a guest, marked External, given epics on the invitation and on
 * their row afterwards.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectRead } from '@/api/generated/models'
import TeamMembersSettings from '@/settings/TeamMembersSettings'

const person = (id: number, full_name: string, is_external = false) => ({
  id,
  email: `${id}@x.dev`,
  username: `u${id}`,
  full_name,
  avatar_color: '#123',
  is_active: true,
  is_external,
})
const AMINA = person(10, 'Amina Khan')
const CARLOS = person(20, 'Carlos Rivera', true)
const TEAM = { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' }

const epic = (id: number, name: string): ProjectRead =>
  ({ id, team_id: 7, name, color: '#6366f1', archived: false }) as ProjectRead

const mocks = vi.hoisted(() => ({
  create: { mutateAsync: vi.fn(), isPending: false },
  update: { mutateAsync: vi.fn(), isPending: false },
  carlosEpics: [] as { id: number; name: string; color: string }[],
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: AMINA }),
}))
vi.mock('@/team/useTeams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/team/useTeams')>()),
  useTeamByKey: () => ({ team: TEAM, isLoading: false, isError: false, teams: [TEAM] }),
}))
vi.mock('@/api/generated/endpoints/teams/teams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/teams/teams')>()),
  useListTeamMembersTeamsTeamIdMembersGet: () => ({
    data: [
      { role: 'admin', joined_at: '2026-01-01T00:00:00Z', user: AMINA, epics: [] },
      {
        role: 'guest',
        joined_at: '2026-09-01T00:00:00Z',
        user: CARLOS,
        epics: mocks.carlosEpics,
      },
    ],
  }),
  useUpdateTeamMemberRoleTeamsTeamIdMembersUserIdPatch: () => mocks.update,
  useRemoveTeamMemberTeamsTeamIdMembersUserIdDelete: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('@/api/generated/endpoints/invites/invites', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/invites/invites')>()),
  useListInvitesTeamsTeamIdInvitesGet: () => ({ data: [] }),
  useCreateInviteTeamsTeamIdInvitesPost: () => mocks.create,
  useRevokeInviteTeamsTeamIdInvitesInviteIdDelete: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('@/api/generated/endpoints/projects/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/projects/projects')>()),
  useListProjectsTeamsTeamIdProjectsGet: () => ({
    data: [epic(1, 'Customer portal'), epic(2, 'Billing')],
  }),
}))
vi.mock('@/api/generated/endpoints/notifications/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/notifications/notifications')>()),
  useGetNotificationSettingsNotificationsSettingsGet: () => ({
    data: { email_delivery_configured: false },
  }),
}))

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/settings/teams/ENG/members']}>
        <Routes>
          <Route path="/settings/teams/:teamKey/members" element={<TeamMembersSettings />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const outside = () => screen.getByRole('checkbox', { name: /outside the organisation/ })

beforeEach(() => {
  mocks.create.mutateAsync.mockReset().mockResolvedValue({
    id: 3,
    email: 'carlos@acme-retail.com',
    token: 'tok',
    external: true,
    epics: [],
  })
  mocks.update.mutateAsync.mockReset().mockResolvedValue({})
  mocks.carlosEpics = [{ id: 1, name: 'Customer portal', color: '#6366f1' }]
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('inviting somebody from outside', () => {
  it('makes them a guest and sends the epics chosen', async () => {
    const user = renderPage()
    expect(screen.queryByText('Epics they can see')).toBeNull()

    await user.click(outside())
    const role = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Invited role' })
    expect(role.value).toBe('guest')
    expect(role.disabled).toBe(true)
    expect(screen.getByText('No epic chosen means no tickets.')).toBeTruthy()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Add an epic' }), '1')
    expect(screen.getByRole('button', { name: 'Remove Customer portal' })).toBeTruthy()
    await user.type(screen.getByPlaceholderText('colleague@example.com'), 'carlos@acme-retail.com')
    await user.click(screen.getByRole('button', { name: 'Send invite' }))

    await waitFor(() => expect(mocks.create.mutateAsync).toHaveBeenCalled())
    expect(mocks.create.mutateAsync.mock.calls[0][0].data).toMatchObject({
      email: 'carlos@acme-retail.com',
      role: 'guest',
      external: true,
      epic_ids: [1],
    })
  })
})

describe('somebody from outside on the roster', () => {
  it('is marked External, with what they see', () => {
    renderPage()
    const row = screen.getByText('Carlos Rivera').closest('li') as HTMLElement
    expect(within(row).getByText('External')).toBeTruthy()
    expect(within(row).getByText('Customer portal only')).toBeTruthy()
    // Only ever a guest: no role to choose.
    expect(within(row).queryByRole('combobox', { name: /Role for/ })).toBeNull()
  })

  it('says plainly when they see nothing', () => {
    mocks.carlosEpics = []
    renderPage()
    expect(screen.getByText('No epics, so no tickets')).toBeTruthy()
  })

  it('lets an admin change their epics, saved at once', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Change epics' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Add an epic' }), '2')
    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
      teamId: 7,
      userId: 20,
      data: { epic_ids: [1, 2] },
    })
  })
})

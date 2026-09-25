// @vitest-environment jsdom
/**
 * Emailing an invitation from the members page (issue #84).
 *
 * The copy-a-link flow is what every instance has; these check email is
 * purely added to it -- offered only where mail can be sent, and reported
 * per invitation so an admin knows which ones went out.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InviteRead } from '@/api/generated/models'
import TeamMembersSettings from '@/settings/TeamMembersSettings'

const ADA = {
  id: 10,
  email: 'ada@example.com',
  username: 'ada',
  full_name: 'Ada Lovelace',
  avatar_color: '#123',
  is_active: true,
}
const TEAM = { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' }

const mocks = vi.hoisted(() => ({
  emailConfigured: false,
  invites: [] as unknown[],
  create: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: ADA }),
}))

vi.mock('@/team/useTeams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/team/useTeams')>()),
  useTeamByKey: () => ({ team: TEAM, isLoading: false, isError: false, teams: [TEAM] }),
}))

vi.mock('@/api/generated/endpoints/teams/teams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/teams/teams')>()),
  useListTeamMembersTeamsTeamIdMembersGet: () => ({
    data: [{ role: 'admin', joined_at: '2026-01-01T00:00:00Z', user: ADA }],
  }),
  useUpdateTeamMemberRoleTeamsTeamIdMembersUserIdPatch: () => ({ mutateAsync: vi.fn() }),
  useRemoveTeamMemberTeamsTeamIdMembersUserIdDelete: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('@/api/generated/endpoints/invites/invites', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/invites/invites')>()),
  useListInvitesTeamsTeamIdInvitesGet: () => ({ data: mocks.invites }),
  useCreateInviteTeamsTeamIdInvitesPost: () => mocks.create,
  useRevokeInviteTeamsTeamIdInvitesInviteIdDelete: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('@/api/generated/endpoints/notifications/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/notifications/notifications')>()),
  useGetNotificationSettingsNotificationsSettingsGet: () => ({
    data: { email_delivery_configured: mocks.emailConfigured },
  }),
}))

function invite(fields: Partial<InviteRead> = {}): InviteRead {
  return {
    id: 3,
    team_id: 7,
    team_name: 'Engineering',
    team_key: 'ENG',
    email: 'new@example.com',
    role: 'member',
    token: 'tok-123',
    invited_by: ADA,
    created_at: '2026-09-25T09:00:00',
    expires_at: '2026-10-02T09:00:00',
    emailed_at: null,
    ...fields,
  }
}

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

async function inviteSomeone(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText('colleague@example.com'), 'new@example.com')
  await user.click(screen.getByRole('button', { name: 'Send invite' }))
}

beforeEach(() => {
  mocks.emailConfigured = false
  mocks.invites = []
  mocks.create.mutateAsync.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('without a mail server', () => {
  it('offers no email option and asks for none, exactly as before', async () => {
    mocks.create.mutateAsync.mockResolvedValue(invite())
    const user = renderPage()

    expect(screen.queryByLabelText('Email the invitation to them')).toBeNull()
    await inviteSomeone(user)

    expect(mocks.create.mutateAsync).toHaveBeenCalledWith({
      teamId: 7,
      data: { email: 'new@example.com', role: 'member', send_email: false },
    })
    await waitFor(() => expect(screen.getByText(/does not send email/)).toBeTruthy())
  })
})

describe('with a mail server', () => {
  beforeEach(() => {
    mocks.emailConfigured = true
  })

  it('emails the invitation by default, and says so', async () => {
    mocks.create.mutateAsync.mockResolvedValue(invite({ emailed_at: '2026-09-25T09:00:00' }))
    const user = renderPage()

    expect(
      (screen.getByLabelText('Email the invitation to them') as HTMLInputElement).checked,
    ).toBe(true)
    await inviteSomeone(user)

    expect(mocks.create.mutateAsync.mock.calls[0][0].data.send_email).toBe(true)
    await waitFor(() => expect(screen.getByText(/Invitation emailed to/)).toBeTruthy())
    // The link is still there to copy.
    expect(screen.getByText(/\/invite\/tok-123$/)).toBeTruthy()
  })

  it('can still just make a link', async () => {
    mocks.create.mutateAsync.mockResolvedValue(invite())
    const user = renderPage()

    await user.click(screen.getByLabelText('Email the invitation to them'))
    await inviteSomeone(user)
    expect(mocks.create.mutateAsync.mock.calls[0][0].data.send_email).toBe(false)
  })

  it('shows which pending invitations were emailed', () => {
    mocks.invites = [
      invite({ id: 1, email: 'emailed@example.com', emailed_at: '2026-09-25T09:00:00' }),
      invite({ id: 2, email: 'copied@example.com' }),
    ]
    renderPage()
    expect(screen.getByText(/Sent to emailed@example\.com/)).toBeTruthy()
    expect(screen.queryByText(/Sent to copied@example\.com/)).toBeNull()
  })

  it('resends the way each invitation was first sent', async () => {
    mocks.invites = [
      invite({ id: 1, email: 'emailed@example.com', emailed_at: '2026-09-25T09:00:00' }),
      invite({ id: 2, email: 'copied@example.com' }),
    ]
    mocks.create.mutateAsync.mockResolvedValue(invite())
    const user = renderPage()

    const [emailed, copied] = screen.getAllByRole('button', { name: 'Resend' })
    await user.click(emailed)
    await user.click(copied)
    const sent = mocks.create.mutateAsync.mock.calls.map(([call]) => [
      call.data.email,
      call.data.send_email,
    ])
    expect(sent).toEqual([
      ['emailed@example.com', true],
      ['copied@example.com', false],
    ])
  })
})

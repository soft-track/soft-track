// @vitest-environment jsdom
/**
 * Inviting many people at once (#304): pasted addresses, a role and teams,
 * a preview before anything is sent, and a summary with links afterwards.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BulkInviteResult, InviteRead } from '@/api/generated/models'
import InviteManyPage from '@/settings/InviteManyPage'

const LENA = {
  id: 10,
  email: 'lena@example.com',
  username: 'lena',
  full_name: 'Lena Fischer',
  avatar_color: '#123',
  is_active: true,
  is_site_admin: false,
}
const TEAM = { id: 7, name: 'Product & Design', key: 'PRD', created_at: '2026-01-01T00:00:00Z' }

const mocks = vi.hoisted(() => ({
  emailConfigured: false,
  siteAdmin: false,
  bulk: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: { ...LENA, is_site_admin: mocks.siteAdmin } }),
}))

vi.mock('@/team/useTeams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/team/useTeams')>()),
  useTeamByKey: () => ({ team: TEAM, isLoading: false, isError: false, teams: [TEAM] }),
}))

vi.mock('@/api/generated/endpoints/teams/teams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/teams/teams')>()),
  useTeamDirectoryTeamsDirectoryGet: () => ({
    data: {
      unlisted_count: 0,
      teams: [
        { id: 3, name: 'Support', key: 'SUP', member_count: 4, admins: [], my_role: 'admin' },
        { id: 7, name: 'Product & Design', key: 'PRD', member_count: 6, admins: [], my_role: 'admin' },
        { id: 9, name: 'Finance', key: 'FIN', member_count: 2, admins: [], my_role: 'member' },
      ],
    },
  }),
}))

vi.mock('@/api/generated/endpoints/invites/invites', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/invites/invites')>()),
  useBulkInviteTeamsTeamIdInvitesBulkPost: () => mocks.bulk,
}))

vi.mock('@/api/generated/endpoints/notifications/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/notifications/notifications')>()),
  useGetNotificationSettingsNotificationsSettingsGet: () => ({
    data: { email_delivery_configured: mocks.emailConfigured },
  }),
}))

function invite(teamId: number, token: string): InviteRead {
  return {
    id: teamId * 100,
    team_id: teamId,
    team_name: teamId === 3 ? 'Support' : 'Product & Design',
    team_key: teamId === 3 ? 'SUP' : 'PRD',
    email: 'hana@northwind.dev',
    role: 'member',
    token,
    invited_by: LENA,
    created_at: '2026-10-12T09:00:00',
    expires_at: '2026-10-19T09:00:00',
    emailed_at: null,
  }
}

const PREVIEW: BulkInviteResult = {
  preview: true,
  sent: 0,
  skipped: 0,
  failed: 0,
  entries: [
    {
      line: 1,
      text: 'Hana Suzuki <hana@northwind.dev>',
      email: 'hana@northwind.dev',
      name: 'Hana Suzuki',
      is_address: true,
      teams: [
        { team_id: 7, team_name: 'Product & Design', kind: 'invite' },
        { team_id: 3, team_name: 'Support', kind: 'invite' },
      ],
    },
    {
      line: 1,
      text: 'yuki@northwind.dev',
      email: 'yuki@northwind.dev',
      is_address: true,
      teams: [
        { team_id: 7, team_name: 'Product & Design', kind: 'invite' },
        { team_id: 3, team_name: 'Support', kind: 'fresh_link' },
      ],
    },
    {
      line: 2,
      text: 'mei@northwind.dev',
      email: 'mei@northwind.dev',
      name: 'Mei Tanaka',
      is_address: true,
      teams: [
        { team_id: 7, team_name: 'Product & Design', kind: 'member', reason: 'already_member' },
        { team_id: 3, team_name: 'Support', kind: 'invite' },
      ],
    },
    { line: 3, text: 'priya.acme.example', is_address: false, teams: [] },
  ],
}

const SENT: BulkInviteResult = {
  preview: false,
  sent: 1,
  skipped: 2,
  failed: 1,
  entries: [
    {
      line: 1,
      text: 'hana@northwind.dev',
      email: 'hana@northwind.dev',
      is_address: true,
      teams: [
        {
          team_id: 7,
          team_name: 'Product & Design',
          kind: 'invite',
          status: 'sent',
          invite: invite(7, 'tok-prd'),
        },
        {
          team_id: 3,
          team_name: 'Support',
          kind: 'invite',
          status: 'failed',
          reason: 'mail_refused',
          invite: invite(3, 'tok-sup'),
        },
      ],
    },
    {
      line: 2,
      text: 'mei@northwind.dev',
      email: 'mei@northwind.dev',
      is_address: true,
      teams: [
        {
          team_id: 7,
          team_name: 'Product & Design',
          kind: 'member',
          status: 'skipped',
          reason: 'already_member',
        },
      ],
    },
    { line: 3, text: 'priya.acme.example', is_address: false, teams: [] },
  ],
}

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/settings/teams/PRD/members/invite']}>
        <Routes>
          <Route path="/settings/teams/:teamKey/members/invite" element={<InviteManyPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.emailConfigured = false
  mocks.siteAdmin = false
  mocks.bulk.mutateAsync.mockReset()
  mocks.bulk.mutateAsync.mockImplementation(({ data }) =>
    Promise.resolve(data.preview ? PREVIEW : SENT),
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('inviting many people', () => {
  it('previews what will happen to each address before sending anything', async () => {
    const user = renderPage()

    // Only the teams Lena administers, this one chosen to begin with.
    expect(screen.getByRole('button', { name: 'Product & Design' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Support' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Finance' })).toBeNull()

    await user.type(
      screen.getByLabelText('Addresses'),
      'Hana Suzuki <hana@northwind.dev>, yuki@northwind.dev',
    )
    await user.click(screen.getByRole('button', { name: 'Support' }))

    await screen.findByText('Before anything is sent')
    const last = mocks.bulk.mutateAsync.mock.calls.at(-1)![0]
    expect(last).toEqual({
      teamId: 7,
      data: {
        addresses: 'Hana Suzuki <hana@northwind.dev>, yuki@northwind.dev',
        role: 'member',
        team_ids: [7, 3],
        send_email: false,
        create_accounts: false,
        preview: true,
      },
    })

    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).getByText('Will be invited')).toBeTruthy()
    expect(within(rows[0]).getByText('to Product & Design and Support')).toBeTruthy()
    expect(within(rows[1]).getByText('Has a live invitation')).toBeTruthy()
    expect(
      within(rows[1]).getByText('fresh link for Support; to Product & Design'),
    ).toBeTruthy()
    expect(within(rows[2]).getByText('Already a member')).toBeTruthy()
    expect(
      within(rows[2]).getByText('of Product & Design; invited to Support'),
    ).toBeTruthy()
    expect(within(rows[3]).getByText('Not an address')).toBeTruthy()
    expect(within(rows[3]).getByText('line 3')).toBeTruthy()
    expect(
      screen.getByText('4 entries · 5 invitations · 1 is not an address'),
    ).toBeTruthy()
    // Previewing sent nothing.
    expect(mocks.bulk.mutateAsync.mock.calls.every(([call]) => call.data.preview)).toBe(true)
  })

  it('sends, then sums up with reasons and the links to copy', async () => {
    const user = renderPage()
    await user.type(screen.getByLabelText('Addresses'), 'hana@northwind.dev')
    await user.click(await screen.findByRole('button', { name: 'Send 5 invitations' }))

    expect(mocks.bulk.mutateAsync.mock.calls.at(-1)![0].data.preview).toBe(false)
    await screen.findByText('Afterwards')
    expect(screen.getByText('sent').previousSibling?.textContent).toBe('1')
    expect(screen.getByText('skipped').previousSibling?.textContent).toBe('2')
    expect(screen.getByText('failed').previousSibling?.textContent).toBe('1')
    expect(screen.getByText('failed: the mail server refused it')).toBeTruthy()
    expect(screen.getByText('skipped: already a member')).toBeTruthy()
    expect(screen.getByText('skipped: not an address')).toBeTruthy()

    // Nothing was emailed, so every link is there to copy, and as CSV.
    expect(screen.getByText('Without SMTP')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Download as CSV' })).toBeTruthy()
  })

  it('emails only where a mail server is configured, and the admin can choose not to', async () => {
    renderPage()
    expect(screen.queryByLabelText('Send the emails')).toBeNull()
    cleanup()

    mocks.emailConfigured = true
    const user = renderPage()
    const box = screen.getByLabelText('Send the emails')
    expect((box as HTMLInputElement).checked).toBe(true)
    await user.type(screen.getByLabelText('Addresses'), 'hana@northwind.dev')
    await waitFor(() =>
      expect(mocks.bulk.mutateAsync.mock.calls.at(-1)?.[0].data.send_email).toBe(true),
    )
    await user.click(box)
    await waitFor(() =>
      expect(mocks.bulk.mutateAsync.mock.calls.at(-1)?.[0].data.send_email).toBe(false),
    )
  })

  it('offers creating accounts to a site admin only', async () => {
    renderPage()
    expect(screen.queryByLabelText(/Create accounts/)).toBeNull()
    cleanup()

    mocks.siteAdmin = true
    const user = renderPage()
    await user.type(screen.getByLabelText('Addresses'), 'hana@northwind.dev')
    await user.click(screen.getByLabelText(/Create accounts/))
    await waitFor(() =>
      expect(mocks.bulk.mutateAsync.mock.calls.at(-1)?.[0].data.create_accounts).toBe(true),
    )
  })
})

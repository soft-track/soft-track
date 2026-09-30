// @vitest-environment jsdom
/**
 * Removing somebody, leaving, or making somebody a guest asks what happens to
 * the open tickets they hold (#316): unassigned, or given to somebody on the
 * team. A guest may be seen in the list but not chosen.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TeamMembersSettings from '@/settings/TeamMembersSettings'

const person = (id: number, full_name: string) => ({
  id,
  email: `${full_name.split(' ')[0].toLowerCase()}@example.com`,
  username: full_name.split(' ')[0].toLowerCase(),
  full_name,
  avatar_color: '#123',
  is_active: true,
})
const ADA = person(10, 'Ada Lovelace')
const TOMAS = person(11, 'Tomas Silva')
const AMINA = person(12, 'Amina Khan')
const CARLOS = person(13, 'Carlos Rivera')
const TEAM = { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' }

const mocks = vi.hoisted(() => ({
  me: 10,
  held: { total: 0, items: [] as { identifier: string }[] },
  heldParams: [] as unknown[],
  remove: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: { id: mocks.me } }),
}))
vi.mock('@/team/useTeams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/team/useTeams')>()),
  useTeamByKey: () => ({ team: TEAM, isLoading: false, isError: false, teams: [TEAM] }),
}))
vi.mock('@/api/generated/endpoints/teams/teams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/teams/teams')>()),
  useListTeamMembersTeamsTeamIdMembersGet: () => ({
    data: [
      { role: 'admin', joined_at: '2026-01-01T00:00:00Z', user: ADA },
      { role: 'member', joined_at: '2026-01-02T00:00:00Z', user: TOMAS },
      { role: 'member', joined_at: '2026-01-03T00:00:00Z', user: AMINA },
      { role: 'guest', joined_at: '2026-01-04T00:00:00Z', user: CARLOS },
    ],
  }),
  useUpdateTeamMemberRoleTeamsTeamIdMembersUserIdPatch: () => ({ mutateAsync: mocks.update }),
  useRemoveTeamMemberTeamsTeamIdMembersUserIdDelete: () => ({ mutateAsync: mocks.remove }),
}))
vi.mock('@/api/generated/endpoints/tickets/tickets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/tickets/tickets')>()),
  useListTicketsTeamsTeamIdTicketsGet: (_teamId: number, params: unknown) => {
    mocks.heldParams.push(params)
    return { data: mocks.held, isPending: false }
  },
}))
vi.mock('@/api/generated/endpoints/invites/invites', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/invites/invites')>()),
  useListInvitesTeamsTeamIdInvitesGet: () => ({ data: [] }),
  useCreateInviteTeamsTeamIdInvitesPost: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRevokeInviteTeamsTeamIdInvitesInviteIdDelete: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('@/api/generated/endpoints/notifications/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/notifications/notifications')>()),
  useGetNotificationSettingsNotificationsSettingsGet: () => ({ data: undefined }),
}))

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/settings/teams/ENG/members']}>
        <Routes>
          <Route path="/settings/teams/:teamKey/members" element={<TeamMembersSettings />} />
          <Route path="/" element={<p>Home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const rowOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement

function holding(...identifiers: string[]) {
  mocks.held = { total: identifiers.length, items: identifiers.map((identifier) => ({ identifier })) }
}

beforeEach(() => {
  mocks.me = 10
  mocks.heldParams = []
  holding()
  mocks.remove.mockReset().mockResolvedValue(undefined)
  mocks.update.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('handing over tickets', () => {
  it('counts the open tickets somebody holds before they are removed', async () => {
    holding('ENG-18', 'ENG-23', 'ENG-31')
    const user = renderPage()
    await user.click(within(rowOf('Tomas Silva')).getByRole('button', { name: 'Remove' }))

    const dialog = screen.getByRole('dialog', { name: 'Remove Tomas Silva from Engineering?' })
    expect(dialog.textContent).toContain('Tomas Silva has 3 open tickets on this team.')
    expect(within(dialog).getByText('ENG-18 · ENG-23 · ENG-31')).toBeTruthy()
    // Open tickets only, and theirs.
    expect(mocks.heldParams.at(-1)).toMatchObject({ assignee_id: 11, resolved: false })
  })

  it('leaves them unassigned unless told otherwise', async () => {
    holding('ENG-18')
    const user = renderPage()
    await user.click(within(rowOf('Tomas Silva')).getByRole('button', { name: 'Remove' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole<HTMLInputElement>('radio', { name: 'Leave it unassigned' }).checked).toBe(true)

    await user.click(within(dialog).getByRole('button', { name: 'Remove member' }))

    expect(mocks.remove).toHaveBeenCalledWith({ teamId: 7, userId: 11, params: undefined })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('hands them to somebody on the team, and never to a guest', async () => {
    holding('ENG-18', 'ENG-23')
    const user = renderPage()
    await user.click(within(rowOf('Tomas Silva')).getByRole('button', { name: 'Remove' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: 'Give them to somebody on the team' }))

    const confirm = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Remove member' })
    expect(confirm.disabled).toBe(true)

    const picker = within(dialog).getByRole<HTMLSelectElement>('combobox', { name: 'Choose a person' })
    const offered = [...picker.options].map((o) => [o.text, o.disabled])
    expect(offered).toEqual([
      ['Choose a person', false],
      ['Ada Lovelace', false],
      ['Amina Khan', false],
      // Seen, not chosen. Tomas is the one leaving, so he is not offered.
      ['Carlos Rivera', true],
    ])
    expect(picker.querySelector('optgroup')?.label).toBe('Guests · read-only')

    await user.selectOptions(picker, 'Amina Khan')
    await user.click(confirm)
    expect(mocks.remove).toHaveBeenCalledWith({ teamId: 7, userId: 11, params: { reassign_to: 12 } })
  })

  it('shows a refusal in the dialog and keeps it open', async () => {
    holding('ENG-18')
    mocks.remove.mockRejectedValue({
      response: { data: { code: 'user_not_on_team', detail: 'The assignee is not a member of this team.' } },
    })
    const user = renderPage()
    await user.click(within(rowOf('Tomas Silva')).getByRole('button', { name: 'Remove' }))
    await user.click(screen.getByRole('button', { name: 'Remove member' }))

    const dialog = await screen.findByRole('dialog')
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'The assignee is not a member of this team.',
    )
  })

  it('asks only the question when there is nothing to hand over', async () => {
    const user = renderPage()
    await user.click(within(rowOf('Tomas Silva')).getByRole('button', { name: 'Remove' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove Tomas Silva from Engineering?' })
    expect(within(dialog).queryByRole('radio')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Remove member' }))
    expect(mocks.remove).toHaveBeenCalledWith({ teamId: 7, userId: 11, params: undefined })
  })

  it('asks the same when you leave', async () => {
    mocks.me = 11
    holding('ENG-18', 'ENG-23')
    const user = renderPage()
    await user.click(within(rowOf('Tomas Silva')).getByRole('button', { name: 'Leave' }))
    const dialog = screen.getByRole('dialog', { name: 'Leave Engineering?' })
    expect(dialog.textContent).toContain('You have 2 open tickets on this team.')
    await user.click(within(dialog).getByRole('button', { name: 'Leave team' }))
    expect(mocks.remove).toHaveBeenCalledWith({ teamId: 7, userId: 11, params: undefined })
    expect(await screen.findByText('Home')).toBeTruthy()
  })

  it('asks before somebody is made a guest, who can hold no tickets', async () => {
    holding('ENG-18')
    const user = renderPage()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Role for Tomas Silva' }), 'guest')

    const dialog = screen.getByRole('dialog', { name: 'Make Tomas Silva a guest?' })
    // Nothing changes until it is answered.
    expect(mocks.update).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('radio', { name: 'Give it to somebody on the team' }))
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Choose a person' }), 'Ada Lovelace')
    await user.click(within(dialog).getByRole('button', { name: 'Make guest' }))

    expect(mocks.update).toHaveBeenCalledWith({
      teamId: 7,
      userId: 11,
      data: { role: 'guest', reassign_to: 10 },
    })
  })

  it('changes any other role straight away', async () => {
    const user = renderPage()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Role for Tomas Silva' }), 'admin')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.update).toHaveBeenCalledWith({ teamId: 7, userId: 11, data: { role: 'admin' } })
  })
})

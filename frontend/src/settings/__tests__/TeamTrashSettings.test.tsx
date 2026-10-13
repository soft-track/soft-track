// @vitest-environment jsdom
/**
 * Settings → a team → Trash (#323): what was deleted, by whom, how long until
 * it is purged, and a way back. Delete forever is a team admin's.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TeamTrashSettings from '@/settings/TeamTrashSettings'

const AMINA = { id: 10, email: 'a@x.dev', username: 'amina', full_name: 'Amina Khan', avatar_color: '#123', is_active: true }
const MEI = { ...AMINA, id: 11, username: 'mei', full_name: 'Mei Tanaka' }
const TEAM = { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z', any_member_may_delete: false }
const DAY = 24 * 60 * 60 * 1000

const mocks = vi.hoisted(() => ({
  role: 'admin' as string,
  trash: undefined as unknown,
  restoreTicket: vi.fn(),
  purgeTicket: vi.fn(),
  restoreEpic: vi.fn(),
  purgeEpic: vi.fn(),
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
    data: [{ role: mocks.role, joined_at: '2026-01-01T00:00:00Z', user: AMINA }],
  }),
}))
vi.mock('@/api/generated/endpoints/trash/trash', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/trash/trash')>()),
  useListTrashTeamsTeamIdTrashGet: () => ({ data: mocks.trash, isLoading: false }),
  useRestoreTicketTrashTicketsTicketIdRestorePost: () => ({ mutateAsync: mocks.restoreTicket }),
  usePurgeTicketTrashTicketsTicketIdDelete: () => ({ mutateAsync: mocks.purgeTicket }),
  useRestoreProjectTrashProjectsProjectIdRestorePost: () => ({ mutateAsync: mocks.restoreEpic }),
  usePurgeProjectTrashProjectsProjectIdDelete: () => ({ mutateAsync: mocks.purgeEpic }),
}))

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/settings/teams/ENG/trash']}>
        <Routes>
          <Route path="/settings/teams/:teamKey/trash" element={<TeamTrashSettings />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

function deletedDaysAgo(days: number) {
  const deleted = Date.now() - days * DAY
  return {
    deleted_at: new Date(deleted).toISOString(),
    purge_at: new Date(deleted + 30 * DAY).toISOString(),
  }
}

beforeEach(() => {
  mocks.role = 'admin'
  mocks.trash = {
    retention_days: 30,
    tickets: [
      {
        id: 310,
        team_id: 7,
        number: 31,
        identifier: 'ENG-31',
        title: 'Portal: export statements as CSV',
        type: 'story',
        deleted_by: MEI,
        ...deletedDaysAgo(2),
      },
      {
        id: 190,
        team_id: 7,
        number: 19,
        identifier: 'ENG-19',
        title: 'Try the new board layout',
        type: 'task',
        deleted_by: MEI,
        ...deletedDaysAgo(26),
      },
    ],
    epics: [
      {
        id: 4,
        team_id: 7,
        name: 'Customer portal',
        color: '#0ea5e9',
        ticket_count: 5,
        deleted_by: MEI,
        ...deletedDaysAgo(1),
      },
    ],
  }
  for (const mock of [mocks.restoreTicket, mocks.purgeTicket, mocks.restoreEpic, mocks.purgeEpic]) {
    mock.mockReset().mockResolvedValue(undefined)
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const rowOf = (text: string) => screen.getByText(text).closest('li') as HTMLElement

describe('TeamTrashSettings', () => {
  it('lists what was deleted, by whom, and how long it has left', () => {
    renderPage()
    expect(screen.getByRole('tab', { name: /Tickets\s*2/ }).getAttribute('aria-selected')).toBe(
      'true',
    )
    const row = rowOf('Portal: export statements as CSV')
    expect(within(row).getByText('ENG-31')).toBeTruthy()
    expect(row.textContent).toContain('deleted by Mei Tanaka, 2 days ago')
    expect(row.textContent).toContain('purged in 28 days')
    expect(rowOf('Try the new board layout').textContent).toContain('purged in 4 days')
    expect(
      screen.getByText(
        /Purged 30 days after deleting, and that is when attachments are removed from storage/,
      ),
    ).toBeTruthy()
  })

  it('restores a ticket', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Restore ENG-31' }))
    expect(mocks.restoreTicket).toHaveBeenCalledWith({ ticketId: 310 })
  })

  it('deletes forever, after asking', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Delete ENG-31 forever' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Delete ENG-31 forever?'))
    expect(mocks.purgeTicket).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Delete ENG-31 forever' }))
    expect(mocks.purgeTicket).toHaveBeenCalledWith({ ticketId: 310 })
  })

  it('lists epics with the tickets that rejoin them', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('tab', { name: /Epics\s*1/ }))
    const row = rowOf('Customer portal')
    expect(row.textContent).toContain('5 tickets rejoin it')
    await user.click(within(row).getByRole('button', { name: 'Restore Customer portal' }))
    expect(mocks.restoreEpic).toHaveBeenCalledWith({ projectId: 4 })
  })

  it('lets a member restore but not delete forever', () => {
    mocks.role = 'member'
    renderPage()
    expect(screen.getByRole('button', { name: 'Restore ENG-31' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Delete ENG-31 forever' })).toBeNull()
    expect(screen.getByText(/Team admins can delete forever sooner/)).toBeTruthy()
  })

  it('shows a guest the trash and nothing to do in it', () => {
    mocks.role = 'guest'
    renderPage()
    expect(screen.getByText('Portal: export statements as CSV')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Restore|forever/ })).toBeNull()
  })

  it('says when there is nothing in it', async () => {
    mocks.trash = { retention_days: 30, tickets: [], epics: [] }
    const user = renderPage()
    expect(screen.getByText('No tickets in the trash.')).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: /Epics/ }))
    expect(screen.getByText('No epics in the trash.')).toBeTruthy()
  })
})

// @vitest-environment jsdom
/**
 * A link to a ticket in the trash (#323) says so: who deleted it, when, until
 * when it can come back, and the way back -- not a bare board and not a 404.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TeamRead } from '@/api/generated/models'
import { TicketPage } from '@/tickets/TicketPage'

const ENG: TeamRead = {
  id: 5,
  name: 'Engineering',
  key: 'ENG',
  created_at: '2026-01-01T00:00:00Z',
  any_member_may_delete: false,
}
const ME = { id: 1, email: 'me@x.dev', username: 'me', full_name: 'Me', avatar_color: '#123', is_active: true }

const mocks = vi.hoisted(() => ({
  role: 'member' as string,
  refetch: vi.fn(),
  restore: vi.fn(),
  trashed: undefined as unknown,
}))

vi.mock('@/team/useTeams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/team/useTeams')>()),
  useTeamByKey: () => ({ team: ENG, teams: [ENG], isLoading: false }),
}))
vi.mock('@/team/useTeamData', () => ({
  useTeamData: () => ({
    projects: [],
    labels: [],
    sprints: [],
    statuses: [],
    members: [{ role: mocks.role, joined_at: '2026-01-01T00:00:00Z', user: ME }],
  }),
}))
vi.mock('@/realtime/useTeamEvents', () => ({ useTeamEvents: () => {} }))
vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: ME }),
}))
vi.mock('@/api/generated/endpoints/tickets/tickets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/tickets/tickets')>()),
  useGetTicketByNumberTeamsTeamIdTicketsByNumberNumberGet: () => ({
    data: undefined,
    isLoading: false,
    isError: true,
    error: { response: { status: 410, data: { code: 'ticket_in_trash' } } },
    refetch: mocks.refetch,
  }),
}))
vi.mock('@/api/generated/endpoints/trash/trash', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/trash/trash')>()),
  useGetTrashedTicketTeamsTeamIdTrashTicketsNumberGet: () => ({ data: mocks.trashed }),
  useRestoreTicketTrashTicketsTicketIdRestorePost: () => ({
    mutateAsync: mocks.restore,
    isPending: false,
  }),
}))

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/ENG/ticket/31']}>
        <Routes>
          <Route path="/:teamKey/ticket/:ticketNumber" element={<TicketPage />} />
          <Route path="/:teamKey" element={<p>The board</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.role = 'member'
  mocks.refetch.mockReset()
  mocks.restore.mockReset().mockResolvedValue({})
  mocks.trashed = {
    id: 310,
    team_id: 5,
    number: 31,
    identifier: 'ENG-31',
    title: 'Portal: export statements as CSV',
    type: 'story',
    deleted_at: '2026-09-28T10:00:00Z',
    deleted_by: { ...ME, id: 7, full_name: 'Mei Tanaka' },
    purge_at: '2026-10-28T10:00:00Z',
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('a link to a deleted ticket', () => {
  it('says who deleted it and until when it can come back', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'ENG-31 was deleted' })).toBeTruthy()
    expect(
      screen.getByText(
        'By Mei Tanaka on 28 Sep 2026. It can be restored until 28 Oct, with its comments, links and attachments.',
      ),
    ).toBeTruthy()
  })

  it('restores it, and shows it again', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Restore ENG-31' }))
    expect(mocks.restore).toHaveBeenCalledWith({ ticketId: 310 })
    expect(mocks.refetch).toHaveBeenCalled()
  })

  it('offers a guest no way back, but still says what happened', () => {
    mocks.role = 'guest'
    renderPage()
    expect(screen.getByRole('heading', { name: 'ENG-31 was deleted' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Restore ENG-31' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to Engineering' })).toBeTruthy()
  })
})

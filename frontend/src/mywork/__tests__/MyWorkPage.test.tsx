// @vitest-environment jsdom
/**
 * My work (#258): what is mine across every team -- due soon pulled to the
 * top, then by team with the server's totals or as one list; Watching with
 * what last happened; and what waits on me beside it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MyWorkRead, MyWorkTicket } from '@/api/generated/models'
import MyWorkPage from '@/mywork/MyWorkPage'

const mocks = vi.hoisted(() => ({
  work: vi.fn(),
  fetchPage: vi.fn(),
  accept: vi.fn(),
  decline: vi.fn(),
}))

vi.mock('@/api/generated/endpoints/my-work/my-work', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/my-work/my-work')>()),
  useGetMyWorkMeWorkGet: (params: unknown) => mocks.work(params),
  getMyWorkMeWorkGet: (...args: unknown[]) => mocks.fetchPage(...args),
}))
vi.mock('@/api/generated/endpoints/invites/invites', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/invites/invites')>()),
  useAcceptInviteInvitesTokenAcceptPost: () => ({ mutateAsync: mocks.accept, isPending: false }),
  useDeclineInviteInvitesTokenDeclinePost: () => ({
    mutateAsync: mocks.decline,
    isPending: false,
  }),
}))
vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: { id: 1, full_name: 'Mei Tanaka', is_site_admin: false } }),
}))
vi.mock('@/team/useTeamContext', () => ({
  useTeamContext: () => ({
    team: { id: 7, key: 'ENG', name: 'Engineering' },
    teams: [{ id: 7, key: 'ENG', name: 'Engineering' }],
    members: [{ user: { id: 1 }, role: 'member' }],
  }),
}))
vi.mock('@/tickets/NewTicketModal', () => ({
  NewTicketModal: () => <p>New ticket form</p>,
}))

const STARTED = {
  id: 3,
  team_id: 7,
  name: 'In Progress',
  category: 'started',
  position: 2,
  color: '#f29d0b',
} as const

function ticket(id: number, key: string, overrides: Partial<MyWorkTicket> = {}): MyWorkTicket {
  return {
    id,
    team_key: key,
    number: id,
    identifier: `${key}-${id}`,
    title: `Ticket ${key}-${id}`,
    status: STARTED,
    priority: 'high',
    estimate: 2,
    sprint: null,
    type: 'task',
    due_date: null,
    project: null,
    last_activity: null,
    ...overrides,
  }
}

const ENG = { id: 7, key: 'ENG', name: 'Engineering' }
const PRD = { id: 8, key: 'PRD', name: 'Product & Design' }
const NOBODY_WAITING = { invites: [], join_requests: [] }

function byTeam(overrides: Partial<MyWorkRead> = {}): MyWorkRead {
  return {
    tab: 'assigned',
    grouping: 'team',
    counts: { assigned: 9, watching: 4, created: 12 },
    due: [
      ticket(11, 'ENG', {
        title: 'Invoice PDF renders blank on Safari',
        due_date: '2026-09-29',
        project: { id: 1, name: 'Customer portal', color: '#6366f1' },
      }),
    ],
    teams: [
      {
        team: ENG,
        open_count: 6,
        points: 18,
        listed_count: 5,
        tickets: [ticket(10, 'ENG', { title: 'Portal: invoice list page' })],
        offset: 0,
        limit: 5,
      },
      {
        team: PRD,
        open_count: 3,
        points: 5,
        listed_count: 1,
        tickets: [ticket(9, 'PRD', { title: 'Copy for the empty invoice list' })],
        offset: 0,
        limit: 5,
      },
    ],
    tickets: null,
    waiting: NOBODY_WAITING,
    ...overrides,
  }
}

function Where() {
  const location = useLocation()
  return <output aria-label="where">{location.pathname + location.search}</output>
}

function renderPage(path = '/my-work') {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Outlet context={{ openSidebar: () => {} }} />}>
            <Route
              path="/my-work"
              element={
                <>
                  <MyWorkPage />
                  <Where />
                </>
              }
            />
          </Route>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.work.mockImplementation(() => ({ data: byTeam(), isPending: false, isError: false }))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('My work, assigned to me', () => {
  it('pulls what is due to the top, then each team with its totals', () => {
    renderPage()

    expect(mocks.work).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'assigned', grouping: 'team', today: expect.any(String) }),
    )
    const due = screen.getByRole('region', { name: /Due soon and overdue/ })
    expect(within(due).getByText('Invoice PDF renders blank on Safari')).toBeTruthy()
    expect(within(due).getByText('Customer portal')).toBeTruthy()
    const eng = screen.getByRole('region', { name: /Engineering · ENG/ })
    expect(within(eng).getByText('6 open · 18 pts')).toBeTruthy()
    expect(within(eng).getByText('Portal: invoice list page')).toBeTruthy()
    // The counts beside each tab are the server's.
    expect(screen.getByRole('tab', { name: /Assigned to me\s*9/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Created by me\s*12/ })).toBeTruthy()
  })

  it('opens a ticket from its row', async () => {
    const user = renderPage()
    await user.click(screen.getByText('Portal: invoice list page'))
    expect(screen.getByLabelText('where').textContent).toBe('/ENG/ticket/10')
  })

  it('shows the rest of a team on demand, counting what was pulled up', async () => {
    mocks.fetchPage.mockResolvedValue(
      byTeam({
        teams: [
          {
            ...byTeam().teams[0],
            tickets: [2, 3, 4, 5].map((id) => ticket(id, 'ENG')),
            offset: 1,
          },
        ],
      }),
    )
    const user = renderPage()

    // Five listed in Engineering, one shown; nothing more in Product & Design.
    expect(screen.queryByRole('button', { name: /more in Product/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show 4 more in Engineering' }))

    expect(mocks.fetchPage).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'assigned', team_id: 7, offset: 1 }),
    )
    const eng = screen.getByRole('region', { name: /Engineering · ENG/ })
    expect(await within(eng).findByText('Ticket ENG-5')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /more in Engineering/ })).toBeNull()
  })

  it('is one list when asked, with the team in each key', async () => {
    mocks.work.mockImplementation((params: { grouping: string }) => ({
      data:
        params.grouping === 'none'
          ? byTeam({
              grouping: 'none',
              teams: [],
              tickets: {
                items: [ticket(10, 'ENG'), ticket(9, 'PRD')],
                total: 7,
                limit: 25,
                offset: 0,
              },
            })
          : byTeam(),
      isPending: false,
      isError: false,
    }))
    const user = renderPage()

    await user.selectOptions(screen.getByLabelText('Group'), 'none')

    expect(screen.getByLabelText('where').textContent).toBe('/my-work?group=none')
    expect(screen.getByText('ENG-10')).toBeTruthy()
    expect(screen.getByText('PRD-9')).toBeTruthy()
    expect(screen.queryByRole('region', { name: /Engineering · ENG/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Show 5 more' })).toBeTruthy()
  })

  it('says so when nothing is assigned', () => {
    mocks.work.mockImplementation(() => ({
      data: byTeam({ due: [], teams: [], counts: { assigned: 0, watching: 0, created: 0 } }),
      isPending: false,
      isError: false,
    }))
    renderPage()
    expect(screen.getByText('Nothing is assigned to you.')).toBeTruthy()
  })
})

describe('My work, watching', () => {
  it('is a tab, and says what last happened on each ticket', async () => {
    mocks.work.mockImplementation((params: { tab: string }) => ({
      data:
        params.tab === 'watching'
          ? byTeam({
              tab: 'watching',
              due: [],
              teams: [
                {
                  ...byTeam().teams[0],
                  listed_count: 2,
                  tickets: [
                    ticket(9, 'ENG', {
                      title: 'Portal: sign-in',
                      last_activity: {
                        kind: 'commented',
                        at: new Date(Date.now() - 2 * 3600_000).toISOString(),
                        actor: null,
                      },
                    }),
                    ticket(13, 'ENG', {
                      title: 'Rate-limit the portal',
                      last_activity: {
                        kind: 'changed',
                        field: 'assignee',
                        new_label: 'Daniel Okafor',
                        at: new Date().toISOString(),
                        actor: null,
                      },
                    }),
                  ],
                },
              ],
            })
          : byTeam(),
      isPending: false,
      isError: false,
    }))
    const user = renderPage()

    await user.click(screen.getByRole('tab', { name: /Watching/ }))

    expect(screen.getByLabelText('where').textContent).toBe('/my-work?tab=watching')
    expect(screen.getByText('commented about 2 hours ago')).toBeTruthy()
    expect(screen.getByText('assigned to Daniel')).toBeTruthy()
    expect(screen.queryByText('Due soon and overdue')).toBeNull()
  })
})

describe('Waiting on me', () => {
  it('holds invitations to accept and requests to decide', async () => {
    mocks.work.mockImplementation(() => ({
      data: byTeam({
        waiting: {
          invites: [
            {
              id: 1,
              team_id: 9,
              team_name: 'Support',
              team_key: 'SUP',
              email: 'mei@northwind.dev',
              role: 'member',
              token: 'tok',
              invited_by: {
                id: 4,
                email: 'lena@northwind.dev',
                username: 'lena',
                full_name: 'Lena Fischer',
                avatar_color: '#a855f7',
                is_active: true,
              },
              created_at: '2026-10-10T10:00:00',
              expires_at: '2026-10-17T10:00:00',
            },
          ],
          join_requests: [
            {
              id: 5,
              team: ENG,
              requester: {
                id: 6,
                username: 'yuki',
                full_name: 'Yuki Sato',
                avatar_color: '#06b6d4',
                is_active: true,
              },
              created_at: '2026-10-11T10:00:00',
            },
          ],
        },
      }),
      isPending: false,
      isError: false,
    }))
    mocks.accept.mockResolvedValue({ id: 9, key: 'SUP' })
    const user = renderPage()

    expect(screen.getByText('Lena Fischer invited you to Support as a member')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Accept' }))
    expect(mocks.accept).toHaveBeenCalledWith({ token: 'tok' })

    expect(screen.getByText('Yuki Sato asked to join Engineering')).toBeTruthy()
    await user.click(screen.getByRole('link', { name: 'Decide' }))
    expect(screen.getByLabelText('where').textContent).toBe('/settings/teams/ENG/members')
  })

  it('says when nothing is waiting', () => {
    renderPage()
    expect(screen.getByText('Nothing is waiting on you.')).toBeTruthy()
  })
})

describe('My work, new ticket', () => {
  it('creates one on the team beside it', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'New ticket' }))
    expect(screen.getByText('New ticket form')).toBeTruthy()
  })
})

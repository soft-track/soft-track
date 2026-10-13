// @vitest-environment jsdom
/**
 * /teams (#259): the teams there are, and where you stand with each -- on it,
 * asked to join it, free to join it, or able to ask, with a note.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TeamsPage from '@/team/TeamsPage'

const person = (id: number, full_name: string) => ({
  id,
  email: `${id}@example.com`,
  username: `u${id}`,
  full_name,
  avatar_color: '#123',
  is_active: true,
})

const team = (
  id: number,
  key: string,
  name: string,
  description: string,
  member_count: number,
  admins: string[],
  extra: Record<string, unknown> = {},
) => ({
  id,
  key,
  name,
  description,
  member_count,
  admins: admins.map((admin, i) => person(id * 10 + i, admin)),
  open_to_join: false,
  my_role: null,
  my_request: null,
  ...extra,
})

const ENG = team(1, 'ENG', 'Engineering', 'Core engineering team', 8, ['Amina Khan', 'Demo User'], {
  my_request: {
    id: 41,
    note: null,
    created_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    expires_at: '2099-01-01T00:00:00Z',
  },
})
const PRD = team(2, 'PRD', 'Product & Design', 'Discovery and design', 3, ['Lena Fischer'])
const OPS = team(4, 'OPS', 'Office', 'Anything about the office, open to everyone', 11, ['Grace Mwangi'], {
  open_to_join: true,
})
const MINE = team(5, 'WEB', 'Web', 'The website', 4, ['Demo User'], { my_role: 'member' })

const mocks = vi.hoisted(() => ({
  directory: { teams: [] as unknown[], unlisted_count: 0 },
  ask: vi.fn(),
  join: vi.fn(),
  withdraw: vi.fn(),
}))

vi.mock('@/api/generated/endpoints/teams/teams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/teams/teams')>()),
  useTeamDirectoryTeamsDirectoryGet: () => ({
    data: mocks.directory,
    isPending: false,
    isSuccess: true,
  }),
  useAskToJoinTeamsTeamIdJoinRequestsPost: () => ({ mutateAsync: mocks.ask, isPending: false }),
  useJoinOpenTeamTeamsTeamIdJoinPost: () => ({ mutateAsync: mocks.join, isPending: false }),
  useWithdrawJoinRequestTeamsJoinRequestsJoinRequestIdDelete: () => ({
    mutateAsync: mocks.withdraw,
    isPending: false,
  }),
}))

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/teams']}>
        <Routes>
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/:teamKey" element={<p>Board</p>} />
          <Route path="/" element={<p>Home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const row = (name: string) =>
  screen.getAllByRole('listitem').find((item) => item.textContent?.includes(name))!

beforeEach(() => {
  mocks.directory = { teams: [ENG, PRD, OPS, MINE], unlisted_count: 2 }
  mocks.ask.mockReset().mockResolvedValue({})
  mocks.join.mockReset().mockResolvedValue({ key: 'OPS' })
  mocks.withdraw.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
})

describe('TeamsPage', () => {
  it('lists each team with what it is, how many, and who to ask', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Teams' })).toBeTruthy()
    expect(
      screen.getByText(
        'The teams on this SoftTrack. Seeing a team’s work takes membership; asking is how you get it.',
      ),
    ).toBeTruthy()
    expect(within(row('Engineering')).getByText('Core engineering team')).toBeTruthy()
    expect(
      within(row('Engineering')).getByText('8 people · admins Amina Khan, Demo User'),
    ).toBeTruthy()
    expect(screen.getByText('2 teams keep themselves off this list.')).toBeTruthy()
  })

  it('offers each team what fits where you stand', () => {
    renderPage()
    expect(within(row('Engineering')).getByText('Asked about 2 hours ago')).toBeTruthy()
    expect(within(row('Engineering')).getByRole('button', { name: 'Withdraw' })).toBeTruthy()
    expect(within(row('Product & Design')).getByRole('button', { name: 'Ask to join' })).toBeTruthy()
    expect(within(row('Office')).getByRole('button', { name: 'Join' })).toBeTruthy()
    expect(within(row('Web')).getByRole('link', { name: /Open/ }).getAttribute('href')).toBe('/WEB')
  })

  it('asks with a note, naming the admin who will be told', async () => {
    const user = renderPage()
    await user.click(within(row('Product & Design')).getByRole('button', { name: 'Ask to join' }))
    const dialog = screen.getByRole('dialog', { name: 'Ask to join Product & Design' })
    expect(
      within(dialog).getByText('Lena Fischer administers this team and will be notified.'),
    ).toBeTruthy()
    await user.type(within(dialog).getByLabelText(/A note/), 'Tomas sent me')
    await user.click(within(dialog).getByRole('button', { name: 'Send request' }))
    expect(mocks.ask).toHaveBeenCalledWith({ teamId: 2, data: { note: 'Tomas sent me' } })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('sends no note when none is written', async () => {
    const user = renderPage()
    await user.click(within(row('Product & Design')).getByRole('button', { name: 'Ask to join' }))
    await user.click(screen.getByRole('button', { name: 'Send request' }))
    expect(mocks.ask).toHaveBeenCalledWith({ teamId: 2, data: { note: null } })
  })

  it('withdraws a request', async () => {
    const user = renderPage()
    await user.click(within(row('Engineering')).getByRole('button', { name: 'Withdraw' }))
    expect(mocks.withdraw).toHaveBeenCalledWith({ joinRequestId: 41 })
  })

  it('joins an open team at once and opens its board', async () => {
    const user = renderPage()
    await user.click(within(row('Office')).getByRole('button', { name: 'Join' }))
    expect(mocks.join).toHaveBeenCalledWith({ teamId: 4 })
    expect(await screen.findByText('Board')).toBeTruthy()
  })

  it('finds a team by name, key or description', async () => {
    const user = renderPage()
    await user.type(screen.getByRole('searchbox', { name: 'Search teams' }), 'office')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(row('Office')).toBeTruthy()
  })
})

// @vitest-environment jsdom
/**
 * A ticket on a page of its own (#112): found by its team and number, with
 * no board behind it, and page chrome above the shared body.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TicketRead, TeamRead } from '@/api/generated/models'
import { TicketPage } from '@/tickets/TicketPage'
import { modalsIn } from '@/tickets/modals'
import { useRelatedTickets } from '@/tickets/stackContext'
import { surfaceFor } from '@/tickets/surface'

const ENG: TeamRead = { id: 5, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' }

function ticket(number: number, fields: Partial<TicketRead> = {}): TicketRead {
  return {
    id: number * 10,
    team_id: ENG.id,
    team_key: 'ENG',
    number,
    identifier: `ENG-${number}`,
    title: `Ticket ${number}`,
    status: { id: 1, team_id: 5, name: 'Todo', category: 'unstarted', position: 0, color: '#888' },
    ...fields,
  } as unknown as TicketRead
}

const mocks = vi.hoisted(() => ({
  lookup: { team: undefined as TeamRead | undefined, teams: [] as TeamRead[], isLoading: false },
  tickets: new Map<number, TicketRead>(),
  byNumber: vi.fn(),
  list: vi.fn(),
}))

vi.mock('@/team/useTeams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/team/useTeams')>()),
  useTeamByKey: () => mocks.lookup,
}))

vi.mock('@/team/useTeamData', () => ({
  useTeamData: () => ({ projects: [], labels: [], members: [], sprints: [], statuses: [] }),
}))

vi.mock('@/realtime/useTeamEvents', () => ({ useTeamEvents: () => {} }))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: { id: 1 } }),
}))

vi.mock('@/api/generated/endpoints/tickets/tickets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/tickets/tickets')>()),
  useGetTicketByNumberTeamsTeamIdTicketsByNumberNumberGet: (
    teamId: number,
    number: number,
    options: { query: { enabled: boolean } },
  ) => {
    mocks.byNumber(teamId, number, options.query.enabled)
    const found = options.query.enabled ? mocks.tickets.get(number) : undefined
    return found
      ? { data: found, isLoading: false, isError: false, error: null }
      : {
          data: undefined,
          isLoading: false,
          isError: options.query.enabled,
          error: { response: { status: 404 } },
        }
  },
  useGetTicketTicketsTicketIdGet: (_id: number, options?: { query?: { initialData?: TicketRead } }) => ({
    data: options?.query?.initialData,
  }),
  // The board's list. A page that loaded it would be the board in disguise.
  useListTicketsTeamsTeamIdTicketsGet: (...args: unknown[]) => {
    mocks.list(...args)
    return { data: { items: [], total: 0 } }
  },
}))

// The body is its own subject; here it only has to show it was given the
// right ticket, and follow a link the way a section would.
vi.mock('@/tickets/TicketDetailBody', () => ({
  TicketBodySkeleton: () => null,
  TicketDetailBody: ({ ticketId }: { ticketId: number }) => {
    const related = useRelatedTickets()
    return (
      <div>
        <p>Body for ticket {ticketId}</p>
        <button
          type="button"
          onClick={(event) =>
            related.open(
              { id: 30, team_key: 'ENG', number: 3, identifier: 'ENG-3' },
              event.currentTarget,
            )
          }
        >
          Open the parent
        </button>
      </div>
    )
  },
}))

vi.mock('@/notifications/WatchToggle', () => ({
  WatchToggle: () => <button type="button">Watch</button>,
}))

function Where() {
  const location = useLocation()
  return (
    <output
      data-testid="where"
      data-surface={surfaceFor(location.state)}
      data-modals={modalsIn(location.state).length}
    >
      {location.pathname}
    </output>
  )
}

function renderPage(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/:teamKey/ticket/:ticketNumber"
            element={
              <>
                <TicketPage />
                <Where />
              </>
            }
          />
          <Route path="/ENG" element={<p>The board</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.lookup = { team: ENG, teams: [ENG], isLoading: false }
  mocks.tickets = new Map([
    [3, ticket(3, { title: 'Retries' })],
    [7, ticket(7, { title: 'Retry storm', parent: { id: 30, team_key: 'ENG', number: 3, identifier: 'ENG-3', title: 'Retries' } })],
  ])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('the ticket page', () => {
  it('finds the ticket by its team and number, with no board behind it', () => {
    renderPage('/ENG/ticket/7')

    expect(mocks.byNumber).toHaveBeenCalledWith(ENG.id, 7, true)
    expect(screen.getByText('Body for ticket 70')).toBeTruthy()
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('says where the ticket sits: the team, its parent, then itself', () => {
    renderPage('/ENG/ticket/7')

    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    const back = screen.getByRole('link', { name: 'Back to Engineering' })
    expect(back.getAttribute('href')).toBe('/ENG')
    const parent = screen.getByRole('link', { name: 'ENG-3' })
    expect(parent.getAttribute('href')).toBe('/ENG/ticket/3')
    expect(parent.getAttribute('title')).toBe('Parent ticket: Retries')
    const here = crumbs.querySelector('[aria-current="page"]')
    expect(here?.textContent).toContain('ENG-7')
  })

  it('names the browser tab after the ticket, and puts it back after', () => {
    document.title = 'SoftTrack'
    renderPage('/ENG/ticket/7')
    expect(document.title).toBe('ENG-7 Retry storm · SoftTrack')
    cleanup()
    expect(document.title).toBe('SoftTrack')
  })

  it('copies its own address as the permalink', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    renderPage('/ENG/ticket/7')

    await user.click(screen.getByRole('button', { name: /Copy link/ }))

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/ENG/ticket/7`)
    expect(screen.getAllByText('Copied').length).toBeGreaterThan(0)
  })

  it('opens a ticket it links to in a modal over it, and stays where it is (#114)', async () => {
    renderPage('/ENG/ticket/7')

    await userEvent.click(screen.getByRole('button', { name: 'Open the parent' }))

    const modal = screen.getByRole('dialog', { name: 'ENG-3' })
    expect(modal.textContent).toContain('Body for ticket 30')
    expect(screen.getByText('Body for ticket 70')).toBeTruthy()
    const where = screen.getByTestId('where')
    expect(where.textContent).toBe('/ENG/ticket/7')
    expect(where.dataset.surface).toBe('page')
    expect(where.dataset.modals).toBe('1')

    // And Escape, which has nothing else to close here, closes it.
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(where.textContent).toBe('/ENG/ticket/7')
  })

  it('says so when the team has no ticket by that number', () => {
    renderPage('/ENG/ticket/99')

    expect(screen.getByRole('heading', { name: 'No such ticket' })).toBeTruthy()
    expect(
      screen.getByText('ENG-99 does not exist, or it was moved to another team.'),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to Engineering' }).getAttribute('href')).toBe(
      '/ENG',
    )
  })

  it('does not ask the server about a number that is not one', () => {
    renderPage('/ENG/ticket/latest')

    expect(mocks.byNumber).not.toHaveBeenCalledWith(ENG.id, expect.anything(), true)
    expect(screen.getByRole('heading', { name: 'No such ticket' })).toBeTruthy()
  })

  it('says so for a team you are not on', () => {
    mocks.lookup = { team: undefined, teams: [ENG], isLoading: false }
    renderPage('/OPS/ticket/7')

    expect(
      screen.getByText('That team does not exist, or you are not a member of it.'),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: /Go to your teams/ }).getAttribute('href')).toBe('/')
  })
})

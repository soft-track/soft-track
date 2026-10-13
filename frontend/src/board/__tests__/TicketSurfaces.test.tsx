// @vitest-environment jsdom
/**
 * Which surface a ticket opens on, by how you got there (#112).
 *
 * The board and the list keep the panel, and the board stays mounted under
 * it. Search results, notifications, the command palette and the panel's own
 * "Open as page" go to the ticket's page instead -- and Back from there
 * returns to the board as it was, view and search included, although the
 * board was unmounted.
 *
 * Driven through the real routes, BoardPage and TeamRoute; the top bar and
 * the heavy views are stubbed down to the controls these journeys use.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TicketRead, SearchHit, TeamRead } from '@/api/generated/models'
import TeamRoute from '@/app/TeamRoute'
import type { BoardView } from '@/keyboard/useCommands'
import { modalsIn, withModal } from '@/tickets/modals'

const ENG: TeamRead = { id: 5, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' }
const TODO = { id: 1, team_id: 5, name: 'Todo', category: 'unstarted', position: 0, color: '#888' }

const STORM = {
  id: 70,
  team_id: 5,
  team_key: 'ENG',
  number: 7,
  identifier: 'ENG-7',
  title: 'Retry storm',
  status: TODO,
  priority: 'high',
  type: 'bug',
  labels: [],
  blocked_by_count: 0,
  child_count: 0,
  completed_child_count: 0,
} as unknown as TicketRead

const HIT = {
  id: 70,
  team_id: 5,
  team_key: 'ENG',
  number: 7,
  identifier: 'ENG-7',
  title: 'Retry storm',
  status: TODO,
  priority: 'high',
  matched_in: 'title',
  snippet: null,
  updated_at: '2026-09-25T10:00:00',
} as unknown as SearchHit

const mocks = vi.hoisted(() => ({
  mounts: 0,
  // Whether the board's page has the ticket on it, and how many it has in all.
  loaded: true,
  total: 1,
  // What the fetch by number (#111) brings back.
  byNumber: { data: undefined, error: null } as { data?: unknown; error: unknown },
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: { id: 1 } }),
}))

vi.mock('@/team/useTeams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/team/useTeams')>()),
  useTeamByKey: () => ({ team: ENG, teams: [ENG], isLoading: false, isError: false }),
}))

vi.mock('@/team/useTeamData', () => ({
  useTeamData: () => ({ projects: [], labels: [], members: [], sprints: [], statuses: [TODO] }),
}))

vi.mock('@/realtime/useTeamEvents', () => ({ useTeamEvents: () => {} }))

vi.mock('@/views/useSavedViews', () => ({
  useSavedViews: () => ({ views: [], isLoading: false, effectiveDefaultId: null }),
}))

vi.mock('@/api/generated/endpoints/tickets/tickets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/tickets/tickets')>()),
  useListTicketsTeamsTeamIdTicketsGet: () => ({
    data: { items: mocks.loaded ? [STORM] : [], total: mocks.total },
    isLoading: false,
  }),
  useGetTicketByNumberTeamsTeamIdTicketsByNumberNumberGet: () => ({
    ...mocks.byNumber,
    isLoading: false,
  }),
  // The real panel's header, where the stub below hands over to it.
  useGetTicketTicketsTicketIdGet: () => ({ data: STORM }),
}))

vi.mock('@/tickets/TicketHeaderActions', () => ({ TicketHeaderActions: () => null }))

vi.mock('@/tickets/TicketDetailBody', () => ({
  TicketDetailBody: ({ ticketId }: { ticketId: number }) => <p>Body for ticket {ticketId}</p>,
}))

vi.mock('@/api/generated/endpoints/search/search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/search/search')>()),
  useSearchSearchGet: (_params: unknown, options: { query: { enabled: boolean } }) =>
    options.query.enabled
      ? { data: { items: [HIT], total: 1 }, isLoading: false }
      : { data: undefined, isLoading: false },
}))

// The board, counted: remounting it is what would lose the view.
vi.mock('@/board/KanbanBoard', async () => {
  const { useEffect } = await import('react')
  return {
    KanbanBoard: () => {
      useEffect(() => {
        mocks.mounts += 1
      }, [])
      return <p>The kanban board</p>
    },
  }
})

vi.mock('@/board/Sidebar', () => ({ Sidebar: () => null }))

vi.mock('@/board/TopBar', () => ({
  TopBar: (props: {
    view: BoardView
    onViewChange: (view: BoardView) => void
    search: string
    onSearchChange: (value: string) => void
    onOpenNotifiedTicket: (ticket: { team_key: string; number: number }) => void
  }) => (
    <div>
      {(['board', 'list'] as const).map((view) => (
        <button
          key={view}
          type="button"
          aria-pressed={props.view === view}
          onClick={() => props.onViewChange(view)}
        >
          {view}
        </button>
      ))}
      <input
        aria-label="Search"
        value={props.search}
        onChange={(e) => props.onSearchChange(e.target.value)}
      />
      <button
        type="button"
        onClick={() => props.onOpenNotifiedTicket({ team_key: 'ENG', number: 9 })}
      >
        Open the notification
      </button>
    </div>
  ),
}))

// The panel, with a linked ticket to open in a modal over it the way its
// stack does (#114), and the way out to a page that either takes. What the
// board has to explain (#115) -- a ticket its filters hide, a number with
// nothing behind it -- is the real panel's to say.
const LINKED = { id: 250, team_key: 'ENG', number: 25, identifier: 'ENG-25' }

vi.mock('@/tickets/TicketDetailPanel', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/tickets/TicketDetailPanel')>()
  return {
    TicketDetailPanel: (props: Parameters<typeof real.TicketDetailPanel>[0]) => {
      const location = useLocation()
      const navigate = useNavigate()
      if (props.missing || props.onClearFilters) return <real.TicketDetailPanel {...props} />
      const { ticketId, openPage } = props
      return (
        <div>
          <p>Panel for ticket {ticketId}</p>
          <p>Modals over it: {modalsIn(location.state).length}</p>
          <button type="button" onClick={() => openPage?.(STORM)}>
            Open as page
          </button>
          <button
            type="button"
            onClick={() => navigate(location, { state: withModal(location.state, LINKED) })}
          >
            Open the linked ticket
          </button>
          <button type="button" onClick={() => openPage?.(LINKED)}>
            Open the linked ticket as a page
          </button>
        </div>
      )
    },
  }
})

vi.mock('@/tickets/TicketPage', () => ({
  TicketPage: () => {
    const { teamKey, ticketNumber } = useParams()
    const navigate = useNavigate()
    return (
      <div>
        <p>
          Page for {teamKey}-{ticketNumber}
        </p>
        <button type="button" onClick={() => navigate(-1)}>
          Back
        </button>
      </div>
    )
  },
}))

/** Where the app is, filters and all. */
function Address() {
  const location = useLocation()
  return (
    <p>
      Address: {location.pathname}
      {location.search}
    </p>
  )
}

function renderApp(
  initialEntry: string | { pathname: string; search?: string; state?: unknown } = '/ENG',
) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/:teamKey" element={<TeamRoute />} />
          <Route path="/:teamKey/ticket/:ticketNumber" element={<TeamRoute />} />
        </Routes>
        <Address />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.mounts = 0
  mocks.loaded = true
  mocks.total = 1
  mocks.byNumber = { data: undefined, error: null }
  // jsdom has no layout; the palette scrolls its highlight into view.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('opening a ticket from the board', () => {
  it('opens a card in the panel, with the same board still under it', async () => {
    const user = renderApp()
    expect(mocks.mounts).toBe(1)

    // The stubbed board has no cards to click; the list does.
    await user.click(screen.getByRole('button', { name: 'list' }))
    await user.click(screen.getByRole('link', { name: /ENG-7.*Retry storm/ }))

    expect(screen.getByText('Panel for ticket 70')).toBeTruthy()
    // Still the list, so still the same BoardPage: remounting it would have
    // put the board back to its default view.
    expect(screen.getByRole('button', { name: 'list' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByText(/Page for/)).toBeNull()
  })
})

describe('a ticket the board is not showing (#115)', () => {
  const panel = { ticketSurface: 'panel' }

  it('opens a ticket its filters exclude, by number, and says the filters hide it', async () => {
    // Filtered to somebody else, so the board's list does not have ENG-7.
    mocks.loaded = false
    mocks.total = 0
    mocks.byNumber = { data: STORM, error: null }
    renderApp({ pathname: '/ENG/ticket/7', search: '?assignee=2', state: panel })

    // It can only have come from the fetch by number, which filters cannot hide.
    expect(await screen.findByRole('dialog', { name: 'ENG-7 Retry storm' })).toBeTruthy()
    expect(screen.getByText('Not on the board right now: your filters hide it.')).toBeTruthy()
    expect(screen.getByText('The kanban board')).toBeTruthy()
  })

  it('opens a ticket past the first loaded page, with nothing said about filters', async () => {
    mocks.loaded = false
    mocks.total = 60
    mocks.byNumber = { data: STORM, error: null }
    renderApp({ pathname: '/ENG/ticket/7', state: panel })

    expect(await screen.findByText('Panel for ticket 70')).toBeTruthy()
    expect(screen.queryByText(/your filters hide it/)).toBeNull()
  })

  it('says “No such ticket” in the panel for a number with nothing behind it', async () => {
    mocks.byNumber = { data: undefined, error: { response: { status: 404 } } }
    const user = renderApp({ pathname: '/ENG/ticket/999', search: '?assignee=2', state: panel })

    const dialog = await screen.findByRole('dialog', { name: 'ENG-999' })
    expect(within(dialog).getByText('No such ticket')).toBeTruthy()
    expect(
      within(dialog).getByText('ENG-999 does not exist, or it was moved to another team.'),
    ).toBeTruthy()

    // Back to the board as it was, filters and all.
    await user.click(within(dialog).getByRole('button', { name: 'Back to the board' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Address: /ENG?assignee=2')).toBeTruthy()
    expect(screen.getByText('The kanban board')).toBeTruthy()
  })

  it('closes the not-found panel on Escape', async () => {
    mocks.byNumber = { data: undefined, error: { response: { status: 404 } } }
    const user = renderApp({ pathname: '/ENG/ticket/999', state: panel })

    await screen.findByRole('dialog', { name: 'ENG-999' })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Address: /ENG')).toBeTruthy()
  })

  it('does not say “No such ticket” when the ticket could not be loaded', async () => {
    mocks.loaded = false
    mocks.byNumber = { data: undefined, error: { response: { status: 500 } } }
    renderApp({ pathname: '/ENG/ticket/7', state: panel })

    const dialog = await screen.findByRole('dialog', { name: 'ENG-7' })
    expect(within(dialog).getByText('Could not load this ticket.')).toBeTruthy()
    expect(screen.queryByText('No such ticket')).toBeNull()
  })

  it('keeps the panel open when Clear filters is pressed in it', async () => {
    mocks.loaded = false
    mocks.total = 0
    mocks.byNumber = { data: STORM, error: null }
    const user = renderApp({ pathname: '/ENG/ticket/7', search: '?assignee=2', state: panel })

    await user.click(await screen.findByRole('button', { name: 'Clear filters' }))

    // Still the panel, not the ticket's page, and nothing left to explain.
    expect(screen.getByText('Panel for ticket 70')).toBeTruthy()
    expect(screen.queryByText(/Page for/)).toBeNull()
    expect(screen.getByText('Address: /ENG/ticket/7')).toBeTruthy()
  })
})

describe('leaving the board for a ticket page', () => {
  it('opens a search result as a page, and Back returns to the same search', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('button', { name: 'list' }))
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'retry')
    // The result, once the search has settled -- not the list row it replaces.
    await user.click(await screen.findByRole('button', { name: /matched in title/ }))

    // The page, and none of the board.
    expect(screen.getByText('Page for ENG-7')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Search' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(screen.getByRole('button', { name: 'list' }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByRole('textbox', { name: 'Search' }) as HTMLInputElement).value).toBe(
      'retry',
    )
    expect(await screen.findByRole('button', { name: /matched in title/ })).toBeTruthy()
  })

  it('promotes a quick peek to a page on Enter (#113), and Back returns to the list', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('button', { name: 'list' }))
    screen.getByRole('link', { name: /ENG-7.*Retry storm/ }).focus()
    await user.keyboard(' ')
    expect(screen.getByRole('tooltip', { name: 'Preview of ENG-7' })).toBeTruthy()

    await user.keyboard('{Enter}')
    expect(screen.getByText('Page for ENG-7')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('button', { name: 'list' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('opens the panel’s ticket as a page, and Back returns to the panel over the list', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('button', { name: 'list' }))
    await user.click(screen.getByRole('link', { name: /ENG-7.*Retry storm/ }))
    await user.click(screen.getByRole('button', { name: 'Open as page' }))

    expect(screen.getByText('Page for ENG-7')).toBeTruthy()
    expect(screen.queryByText(/Panel for/)).toBeNull()

    // The glance you left, over the view you left it on.
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Panel for ticket 70')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'list' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps the modals over the panel for Back, when one of them leaves for a page (#114)', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('button', { name: 'list' }))
    await user.click(screen.getByRole('link', { name: /ENG-7.*Retry storm/ }))
    await user.click(screen.getByRole('button', { name: 'Open the linked ticket' }))
    expect(screen.getByText('Modals over it: 1')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Open the linked ticket as a page' }))
    expect(screen.getByText('Page for ENG-25')).toBeTruthy()

    // Back to the panel as it was: the modal still over it, the list under it.
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Panel for ticket 70')).toBeTruthy()
    expect(screen.getByText('Modals over it: 1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'list' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('opens a notification as a page', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('button', { name: 'Open the notification' }))
    expect(screen.getByText('Page for ENG-9')).toBeTruthy()
  })

  it('opens a ticket from the command palette as a page', async () => {
    const user = renderApp()
    await user.keyboard('{Meta>}k{/Meta}')
    await user.type(screen.getByRole('textbox', { name: 'Command' }), 'storm')
    await user.keyboard('{Enter}')
    expect(screen.getByText('Page for ENG-7')).toBeTruthy()
  })
})

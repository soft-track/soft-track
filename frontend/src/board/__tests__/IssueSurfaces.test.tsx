// @vitest-environment jsdom
/**
 * Which surface an issue opens on, by how you got there (#112).
 *
 * The board and the list keep the panel, and the board stays mounted under
 * it. Search results, notifications and the command palette go to the
 * issue's page instead -- and Back from there returns to the board as it
 * was, view and search included, although the board was unmounted.
 *
 * Driven through the real routes, BoardPage and TeamRoute; the top bar and
 * the heavy views are stubbed down to the controls these journeys use.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IssueRead, SearchHit, TeamRead } from '@/api/generated/models'
import TeamRoute from '@/app/TeamRoute'
import type { BoardView } from '@/keyboard/useCommands'

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
} as unknown as IssueRead

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

const mocks = vi.hoisted(() => ({ mounts: 0 }))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: { id: 1 } }),
}))

vi.mock('@/team/useTeams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/team/useTeams')>()),
  useTeamByKey: () => ({ team: ENG, teams: [ENG], isLoading: false, isError: false }),
}))

vi.mock('@/team/useTeamData', () => ({
  useTeamData: () => ({ projects: [], labels: [], members: [], cycles: [], statuses: [TODO] }),
}))

vi.mock('@/realtime/useTeamEvents', () => ({ useTeamEvents: () => {} }))

vi.mock('@/views/useSavedViews', () => ({
  useSavedViews: () => ({ views: [], isLoading: false, effectiveDefaultId: null }),
}))

vi.mock('@/api/generated/endpoints/issues/issues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/issues/issues')>()),
  useListIssuesTeamsTeamIdIssuesGet: () => ({
    data: { items: [STORM], total: 1 },
    isLoading: false,
  }),
  useGetIssueByNumberTeamsTeamIdIssuesByNumberNumberGet: () => ({ data: undefined }),
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
    onOpenNotifiedIssue: (issue: { team_key: string; number: number }) => void
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
        onClick={() => props.onOpenNotifiedIssue({ team_key: 'ENG', number: 9 })}
      >
        Open the notification
      </button>
    </div>
  ),
}))

vi.mock('@/issues/IssueDetailPanel', () => ({
  IssueDetailPanel: ({ issueId }: { issueId: number }) => <p>Panel for issue {issueId}</p>,
}))

vi.mock('@/issues/IssuePage', () => ({
  IssuePage: () => {
    const { teamKey, issueNumber } = useParams()
    const navigate = useNavigate()
    return (
      <div>
        <p>
          Page for {teamKey}-{issueNumber}
        </p>
        <button type="button" onClick={() => navigate(-1)}>
          Back
        </button>
      </div>
    )
  },
}))

function renderApp() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/ENG']}>
        <Routes>
          <Route path="/:teamKey" element={<TeamRoute />} />
          <Route path="/:teamKey/issue/:issueNumber" element={<TeamRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.mounts = 0
  // jsdom has no layout; the palette scrolls its highlight into view.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('opening an issue from the board', () => {
  it('opens a card in the panel, with the same board still under it', async () => {
    const user = renderApp()
    expect(mocks.mounts).toBe(1)

    // The stubbed board has no cards to click; the list does.
    await user.click(screen.getByRole('button', { name: 'list' }))
    await user.click(screen.getByRole('button', { name: /ENG-7.*Retry storm/ }))

    expect(screen.getByText('Panel for issue 70')).toBeTruthy()
    // Still the list, so still the same BoardPage: remounting it would have
    // put the board back to its default view.
    expect(screen.getByRole('button', { name: 'list' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByText(/Page for/)).toBeNull()
  })
})

describe('leaving the board for an issue page', () => {
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
    screen.getByRole('button', { name: /ENG-7.*Retry storm/ }).focus()
    await user.keyboard(' ')
    expect(screen.getByRole('tooltip', { name: 'Preview of ENG-7' })).toBeTruthy()

    await user.keyboard('{Enter}')
    expect(screen.getByText('Page for ENG-7')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('button', { name: 'list' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('opens a notification as a page', async () => {
    const user = renderApp()
    await user.click(screen.getByRole('button', { name: 'Open the notification' }))
    expect(screen.getByText('Page for ENG-9')).toBeTruthy()
  })

  it('opens an issue from the command palette as a page', async () => {
    const user = renderApp()
    await user.keyboard('{Meta>}k{/Meta}')
    await user.type(screen.getByRole('textbox', { name: 'Command' }), 'storm')
    await user.keyboard('{Enter}')
    expect(screen.getByText('Page for ENG-7')).toBeTruthy()
  })
})

// @vitest-environment jsdom
/**
 * Grouping the board and the list by project, and saved views that remember
 * it (issue #63).
 *
 * The saved-view hooks are replaced at the module boundary, so a test sees
 * exactly what a save would send and what applying a view hands back.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  IssueRead,
  ProjectRead,
  SavedViewRead,
  StatusRead,
  TeamMemberRead,
} from '@/api/generated/models'
import { NO_FILTERS } from '@/board/filters'
import { DEFAULT_SORT } from '@/board/sorting'
import { IssueListView } from '@/board/IssueListView'
import { KanbanBoard } from '@/board/KanbanBoard'
import { TeamProvider } from '@/team/TeamContext'
import type { TeamContextValue } from '@/team/useTeamContext'
import { SaveViewModal } from '@/views/SaveViewModal'
import { ViewList } from '@/views/ViewList'

const mocks = vi.hoisted(() => ({
  list: { data: undefined as unknown, isLoading: false },
  create: { mutateAsync: vi.fn() },
  update: { mutateAsync: vi.fn() },
}))

// ViewList asks who is signed in, to decide who may edit a view.
vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: { id: 10 } }),
}))

vi.mock('@/api/generated/endpoints/views/views', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/views/views')>()),
  useListViewsTeamsTeamIdViewsGet: () => mocks.list,
  useCreateViewTeamsTeamIdViewsPost: () => mocks.create,
  useUpdateViewViewsViewIdPatch: () => mocks.update,
}))

function status(id: number, name: string): StatusRead {
  return { id, team_id: 7, name, category: 'unstarted', position: id, color: '#888' }
}

function project(id: number, name: string, color: string): ProjectRead {
  return {
    id,
    team_id: 7,
    name,
    color,
    state: 'in_progress',
    archived: false,
    created_at: '2026-01-01T00:00:00Z',
    issue_count: 0,
    completed_issue_count: 0,
  }
}

const TODO = status(1, 'Todo')
const DOING = status(2, 'Doing')
const PLATFORM = project(5, 'Platform', '#ff0000')
const BILLING = project(6, 'Billing', '#00ff00')

const ADA: TeamMemberRead = {
  role: 'admin',
  joined_at: '2026-01-01T00:00:00Z',
  user: {
    id: 10,
    email: 'ada@example.com',
    username: 'ada',
    full_name: 'Ada Lovelace',
    avatar_color: '#123',
    is_active: true,
  },
}

const TEAM: TeamContextValue = {
  team: { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' },
  teams: [],
  projects: [PLATFORM, BILLING],
  labels: [],
  members: [ADA],
  cycles: [],
  statuses: [TODO, DOING],
}

function issue(id: number, title: string, inStatus: StatusRead, projectId: number | null) {
  return {
    id,
    team_id: 7,
    team_key: 'ENG',
    project_id: projectId,
    number: id,
    identifier: `ENG-${id}`,
    title,
    status: inStatus,
    priority: 'no_priority',
    type: 'task',
    rank: 'a0',
    blocked_by_count: 0,
    child_count: 0,
    completed_child_count: 0,
    creator: ADA.user,
    labels: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as IssueRead
}

const ISSUES = [
  issue(1, 'Migrate the queue', TODO, PLATFORM.id),
  issue(2, 'Invoice PDFs', DOING, BILLING.id),
  issue(3, 'Loose end', DOING, null),
]

function renderWith(children: ReactNode) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamProvider value={TEAM}>
        <MemoryRouter>{children}</MemoryRouter>
      </TeamProvider>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const column = (name: string) => screen.getByRole('region', { name })

function savedView(id: number, name: string, group_by: SavedViewRead['group_by']): SavedViewRead {
  return {
    id,
    team_id: 7,
    name,
    owner: ADA.user,
    is_shared: false,
    filters: {},
    group_by,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

beforeEach(() => {
  mocks.list.data = { items: [] }
  mocks.create.mutateAsync.mockReset().mockResolvedValue({})
  mocks.update.mutateAsync.mockReset().mockResolvedValue({})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the board', () => {
  it('is one column per status, with a project badge on each card', () => {
    renderWith(<KanbanBoard issues={ISSUES} onStatusChange={() => {}} />)

    expect(within(column('Todo')).getByText('Migrate the queue')).toBeTruthy()
    // The badge is the project's name, so the colour is never the only cue.
    expect(within(column('Todo')).getByTitle('Project: Platform')).toBeTruthy()
    expect(within(column('Doing')).getByTitle('Project: Billing')).toBeTruthy()
  })

  it('is one column per project when grouped by project, with no-project last', () => {
    renderWith(
      <KanbanBoard issues={ISSUES} grouping="project" onStatusChange={() => {}} />,
    )

    const names = screen
      .getAllByRole('region')
      .map((region) => region.getAttribute('aria-label'))
    expect(names).toEqual(['Billing', 'Platform', 'No project'])
    expect(within(column('No project')).getByText('Loose end')).toBeTruthy()

    // The column says the project, so the card says the status instead.
    const card = within(column('Platform'))
    expect(card.queryByTitle('Project: Platform')).toBeNull()
    expect(card.getByTitle('Todo')).toBeTruthy()
  })
})

describe('the list', () => {
  it('stays one flat list by status', () => {
    renderWith(<IssueListView issues={ISSUES} />)
    expect(screen.queryAllByRole('heading', { level: 2 })).toEqual([])
  })

  it('splits into a section per project, leaving empty ones out', () => {
    renderWith(
      <IssueListView issues={[ISSUES[0], ISSUES[2]]} grouping="project" />,
    )
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)
    expect(headings).toEqual(['Platform1', 'No project1'])
  })
})

describe('saved views carry the grouping', () => {
  it('applies a view’s grouping along with its filters', async () => {
    mocks.list.data = { items: [savedView(1, 'Planning', 'project')] }
    const onApply = vi.fn()
    const user = renderWith(
      <ViewList filters={NO_FILTERS} arrangement={{ grouping: 'status', sort: DEFAULT_SORT }} onApply={onApply} onEdit={() => {}} isAdmin />,
    )

    await user.click(screen.getByRole('button', { name: 'Planning' }))
    expect(onApply).toHaveBeenCalledWith(NO_FILTERS, {
      grouping: 'project',
      sort: DEFAULT_SORT,
    })
  })

  it('only marks a view as showing when the grouping matches too', () => {
    mocks.list.data = { items: [savedView(1, 'Planning', 'project')] }
    renderWith(
      <ViewList filters={NO_FILTERS} arrangement={{ grouping: 'status', sort: DEFAULT_SORT }} onApply={() => {}} onEdit={() => {}} isAdmin />,
    )
    const row = screen.getByRole('button', { name: 'Planning' })
    expect(row.getAttribute('data-active')).toBe('false')
  })

  it('applies a view’s sort along with it (#88)', async () => {
    mocks.list.data = {
      items: [{ ...savedView(1, 'Hot', 'status'), sort: 'priority', sort_direction: 'desc' }],
    }
    const onApply = vi.fn()
    const user = renderWith(
      <ViewList
        filters={NO_FILTERS}
        arrangement={{ grouping: 'status', sort: DEFAULT_SORT }}
        onApply={onApply}
        onEdit={() => {}}
        isAdmin
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Hot' }))
    expect(onApply).toHaveBeenCalledWith(NO_FILTERS, {
      grouping: 'status',
      sort: { sort: 'priority', direction: 'desc' },
    })
  })

  it('saves the sort with a new view, and nothing for the default (#88)', async () => {
    const user = renderWith(
      <SaveViewModal
        filters={NO_FILTERS}
        grouping="status"
        sort={{ sort: 'title', direction: 'asc' }}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText(/sorted by title, ascending/)).toBeTruthy()
    await user.type(screen.getByRole('textbox'), 'A to Z')
    await user.click(screen.getByRole('button', { name: 'Save view' }))
    expect(mocks.create.mutateAsync).toHaveBeenCalledWith({
      teamId: 7,
      data: expect.objectContaining({ sort: 'title', sort_direction: 'asc' }),
    })
  })

  it('saves the grouping with a new view', async () => {
    const user = renderWith(
      <SaveViewModal filters={NO_FILTERS} grouping="project" onClose={() => {}} />,
    )
    expect(screen.getByText('All issues · grouped by project')).toBeTruthy()

    await user.type(screen.getByRole('textbox'), 'Planning')
    await user.click(screen.getByRole('button', { name: 'Save view' }))
    expect(mocks.create.mutateAsync).toHaveBeenCalledWith({
      teamId: 7,
      data: expect.objectContaining({ name: 'Planning', group_by: 'project' }),
    })
  })
})

// @vitest-environment jsdom
/**
 * The project page, driven the way a person drives it.
 *
 * The generated hooks are replaced at the module boundary, so the test sees
 * what the page would send without a network layer. Progress is the server's
 * number -- the fixtures below deliberately give it one the loaded issues
 * could not have produced, so a page that counted for itself would show it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  IssueRead,
  ProjectRead,
  SearchHit,
  StatusRead,
  TeamMemberRead,
} from '@/api/generated/models'
import { ProjectPage } from '@/projects/ProjectPage'
import { TeamProvider } from '@/team/TeamContext'
import type { TeamContextValue } from '@/team/useTeamContext'

const state = vi.hoisted(() => ({
  project: undefined as ProjectRead | undefined,
  issues: [] as IssueRead[],
  total: 0,
  hits: [] as SearchHit[],
  updateIssue: vi.fn(),
  updateProject: vi.fn(),
}))

vi.mock('@/api/generated/endpoints/projects/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/projects/projects')>()),
  useGetProjectProjectsProjectIdGet: () => ({ data: state.project, isLoading: false }),
  useUpdateProjectProjectsProjectIdPatch: () => ({
    mutateAsync: state.updateProject,
    isPending: false,
  }),
}))

vi.mock('@/api/generated/endpoints/issues/issues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/issues/issues')>()),
  useListIssuesTeamsTeamIdIssuesGet: () => ({
    data: { items: state.issues, total: state.total, limit: 200, offset: 0 },
    isLoading: false,
  }),
  useUpdateIssueIssuesIssueIdPatch: () => ({ mutateAsync: state.updateIssue, isPending: false }),
}))

vi.mock('@/api/generated/endpoints/search/search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/search/search')>()),
  useSearchSearchGet: (_params: unknown, options: { query: { enabled: boolean } }) => ({
    data: options.query.enabled ? { items: state.hits, total: state.hits.length } : undefined,
    isLoading: false,
  }),
}))

// The slide-over pulls in the whole issue editor; what it does is its own
// concern. Standing in for it keeps this test about the page.
vi.mock('@/issues/IssueDetailPanel', () => ({
  IssueDetailPanel: ({ issueId }: { issueId: number }) => (
    <div role="dialog" aria-label={`Issue ${issueId}`} />
  ),
}))

vi.mock('@/markdown/lazy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/markdown/lazy')>()),
  Markdown: ({ children }: { children: string }) => <p>{children}</p>,
}))

function status(id: number, name: string, category: StatusRead['category']): StatusRead {
  return { id, team_id: 7, name, category, position: id, color: '#888' }
}

const TODO = status(1, 'Todo', 'unstarted')
const DOING = status(2, 'In Progress', 'started')
const DONE = status(3, 'Done', 'done')
const CANCELLED = status(4, 'Cancelled', 'cancelled')

function member(id: number, full_name: string): TeamMemberRead {
  return {
    role: 'member',
    joined_at: '2026-01-01T00:00:00Z',
    user: {
      id,
      email: `${id}@example.com`,
      username: `user${id}`,
      full_name,
      avatar_color: '#123',
      is_active: true,
    },
  }
}

function issue(id: number, title: string, on: StatusRead): IssueRead {
  return {
    id,
    team_id: 7,
    team_key: 'ENG',
    project_id: 20,
    number: id,
    identifier: `ENG-${id}`,
    title,
    status: on,
    priority: 'no_priority',
    blocked_by_count: 0,
    child_count: 0,
    completed_child_count: 0,
    creator: member(10, 'Ada Lovelace').user,
    labels: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function project(overrides: Partial<ProjectRead> = {}): ProjectRead {
  return {
    id: 20,
    team_id: 7,
    name: 'Platform',
    description: 'Move everything onto the new platform.',
    color: '#6366f1',
    lead_id: 11,
    target_date: '2099-10-01',
    state: 'in_progress',
    archived: false,
    issue_count: 7,
    completed_issue_count: 3,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const TEAM: TeamContextValue = {
  team: { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' },
  teams: [],
  projects: [],
  labels: [],
  members: [member(10, 'Ada Lovelace'), member(11, 'Grace Hopper')],
  cycles: [],
  statuses: [TODO, DOING, DONE, CANCELLED],
}

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <TeamProvider value={TEAM}>
          <ProjectPage projectId={20} onOpenSidebar={() => {}} />
        </TeamProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  state.project = project()
  state.issues = [
    issue(1, 'Ship the thing', DONE),
    issue(2, 'Write the migration', TODO),
    issue(3, 'Not doing this after all', CANCELLED),
    issue(4, 'Wire the API', DOING),
  ]
  state.total = state.issues.length
  state.hits = []
  state.updateIssue.mockReset().mockResolvedValue({})
  state.updateProject.mockReset().mockResolvedValue({})
})

afterEach(cleanup)

describe('ProjectPage', () => {
  it('shows the header: name, state, lead, target and description', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Platform' })).toBeTruthy()
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'State' }).value).toBe(
      'in_progress',
    )
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Lead' }).value).toBe('11')
    expect(screen.getByText('Due 1 Oct 2099')).toBeTruthy()
    expect(screen.getByText('Move everything onto the new platform.')).toBeTruthy()
  })

  it("reports the server's progress and says cancelled work is not counted", () => {
    renderPage()
    const progress = screen.getByRole('region', { name: 'Progress' })
    expect(progress.textContent).toContain('3 of 7 done')
    expect(within(progress).getByText('43%')).toBeTruthy()
    expect(within(progress).getByText(/1 cancelled, not counted/)).toBeTruthy()
  })

  it("groups the issues by status in the team's column order", () => {
    renderPage()
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Todo1', 'In Progress1', 'Done1', 'Cancelled1'])
  })

  it('removes an issue from the project', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Remove ENG-2 from Platform' }))
    expect(state.updateIssue).toHaveBeenCalledWith({ issueId: 2, data: { project_id: null } })
  })

  it('adds an issue found by search, leaving out the ones already in it', async () => {
    state.hits = [
      { id: 2, identifier: 'ENG-2', title: 'Write the migration' } as SearchHit,
      { id: 9, identifier: 'ENG-9', title: 'Retire the old cluster' } as SearchHit,
    ]
    const user = renderPage()

    await user.click(screen.getByRole('button', { name: 'Add issues' }))
    await user.type(screen.getByRole('textbox', { name: 'Search issues to add' }), 'cluster')
    const add = await screen.findByRole('button', { name: 'Add ENG-9 to Platform' })
    expect(screen.queryByRole('button', { name: 'Add ENG-2 to Platform' })).toBeNull()

    await user.click(add)
    expect(state.updateIssue).toHaveBeenCalledWith({ issueId: 9, data: { project_id: 20 } })
  })

  it('changes the state from the header', async () => {
    const user = renderPage()
    await user.selectOptions(screen.getByRole('combobox', { name: 'State' }), 'completed')
    expect(state.updateProject).toHaveBeenCalledWith({
      projectId: 20,
      data: { state: 'completed' },
    })
  })

  it('marks a missed target on an open project as overdue', () => {
    state.project = project({ target_date: '2020-01-01' })
    renderPage()
    expect(screen.getByText('Overdue since 1 Jan 2020')).toBeTruthy()
  })

  it('opens an issue in the slide-over', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: /Wire the API/ }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Issue 4' })).toBeTruthy())
  })

  it('explains how issues get into an empty project', () => {
    state.issues = []
    state.total = 0
    state.project = project({ issue_count: 0, completed_issue_count: 0 })
    renderPage()
    expect(screen.getByText('Nothing in this project yet.')).toBeTruthy()
    expect(screen.getByText(/when filing a new issue/)).toBeTruthy()
    expect(screen.getByText(/set the project from the bar that appears/)).toBeTruthy()
  })

  it('says when the project holds more issues than the page shows', () => {
    state.total = 250
    renderPage()
    expect(screen.getByText('Showing the first 4 of 250 issues.')).toBeTruthy()
  })
})

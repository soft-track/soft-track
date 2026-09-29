// @vitest-environment jsdom
/**
 * A project's own page (issue #61): what is in it, how far along it is, and
 * moving tickets in and out.
 *
 * The generated query and mutation hooks are replaced at the module boundary,
 * so a test sees exactly what the page would send. The ticket panel is stubbed:
 * it has its own tests, and here only whether it opens matters.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  TicketRead,
  ProjectRead,
  StatusRead,
  TeamMemberRead,
} from '@/api/generated/models'
import { ProjectPage } from '@/projects/ProjectPage'
import { TeamProvider } from '@/team/TeamContext'
import type { TeamContextValue } from '@/team/useTeamContext'

const mocks = vi.hoisted(() => ({
  project: { data: undefined as unknown, isLoading: false },
  tickets: { data: undefined as unknown, isLoading: false },
  search: { data: undefined as unknown, isLoading: false },
  burnup: { data: undefined as unknown },
  updateProject: { mutateAsync: vi.fn(), isPending: false },
  updateTicket: { mutateAsync: vi.fn(), isPending: false },
  bulkUpdate: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock('@/api/generated/endpoints/projects/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/projects/projects')>()),
  useGetProjectProjectsProjectIdGet: () => mocks.project,
  useUpdateProjectProjectsProjectIdPatch: () => mocks.updateProject,
}))

vi.mock('@/api/generated/endpoints/tickets/tickets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/tickets/tickets')>()),
  useListTicketsTeamsTeamIdTicketsGet: () => mocks.tickets,
  useUpdateTicketTicketsTicketIdPatch: () => mocks.updateTicket,
  useBulkUpdateTicketsTeamsTeamIdTicketsBulkUpdatePost: () => mocks.bulkUpdate,
}))

vi.mock('@/api/generated/endpoints/reports/reports', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/reports/reports')>()),
  useProjectBurnupProjectsProjectIdBurnupGet: () => mocks.burnup,
}))

vi.mock('@/api/generated/endpoints/search/search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/search/search')>()),
  useSearchSearchGet: () => mocks.search,
}))

vi.mock('@/tickets/TicketDetailPanel', () => ({
  TicketDetailPanel: ({ ticketId }: { ticketId: number }) => <p>Panel for ticket {ticketId}</p>,
}))

function status(id: number, name: string, category: StatusRead['category']): StatusRead {
  return { id, team_id: 7, name, category, position: id, color: '#888' }
}

const TODO = status(1, 'Todo', 'unstarted')
const DOING = status(2, 'In Progress', 'started')
const DONE = status(3, 'Done', 'done')

const ADA: TeamMemberRead = {
  role: 'member',
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
  projects: [],
  labels: [],
  members: [ADA],
  sprints: [],
  statuses: [TODO, DOING, DONE],
}

const PLATFORM: ProjectRead = {
  id: 5,
  team_id: 7,
  name: 'Platform',
  description: 'The new platform.',
  color: '#6366f1',
  lead_id: null,
  target_date: '2026-12-01',
  state: 'in_progress',
  archived: false,
  created_at: '2026-01-01T00:00:00Z',
  ticket_count: 3,
  completed_ticket_count: 1,
}

function ticket(id: number, title: string, inStatus: StatusRead): TicketRead {
  return {
    id,
    team_id: 7,
    team_key: 'ENG',
    project_id: PLATFORM.id,
    number: id,
    identifier: `ENG-${id}`,
    title,
    status: inStatus,
    priority: 'no_priority',
    type: 'task',
    rank: 'a0',
    blocked_by_count: 0,
    custom_fields: {},
    child_count: 0,
    completed_child_count: 0,
    creator: ADA.user,
    labels: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function showing(project: ProjectRead | undefined, tickets: TicketRead[]) {
  mocks.project.data = project
  mocks.tickets.data = { items: tickets, total: tickets.length, limit: 200, offset: 0 }
}

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamProvider value={TEAM}>
        <MemoryRouter>
          <ProjectPage projectId={PLATFORM.id} />
        </MemoryRouter>
      </TeamProvider>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.search.data = undefined
  mocks.burnup.data = undefined
  mocks.updateProject.mutateAsync.mockReset().mockResolvedValue(PLATFORM)
  mocks.updateTicket.mutateAsync.mockReset().mockResolvedValue({})
  mocks.bulkUpdate.mutateAsync.mockReset().mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('what is in it and how far along', () => {
  it('shows progress and the tickets grouped by column, in board order', () => {
    showing(PLATFORM, [
      ticket(1, 'Ship it', DONE),
      ticket(2, 'Write it', TODO),
      ticket(3, 'Test it', DOING),
    ])
    renderPage()

    expect(screen.getByRole('heading', { name: 'Platform' })).toBeTruthy()
    expect(screen.getByText('1 of 3 done')).toBeTruthy()
    expect(screen.getByText('33%')).toBeTruthy()

    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)
    expect(headings).toEqual(['Todo1', 'In Progress1', 'Done1'])
  })

  it('says how tickets get in, when nothing has yet', () => {
    showing({ ...PLATFORM, ticket_count: 0, completed_ticket_count: 0 }, [])
    renderPage()

    expect(screen.getByText('No tickets in this epic yet')).toBeTruthy()
    expect(screen.getByText(/Epic field when creating a ticket/)).toBeTruthy()
    expect(screen.getByText('Nothing in this epic yet')).toBeTruthy()
  })

  it('shows the burnup once it has loaded', () => {
    showing(PLATFORM, [])
    mocks.burnup.data = {
      project_id: 5,
      project_name: 'Platform',
      started_on: '2026-09-20',
      points: [
        {
          day: '2026-09-20',
          scope_tickets: 2,
          completed_tickets: 1,
          scope_points: 5,
          completed_points: 3,
          unestimated_tickets: 0,
        },
      ],
    }
    renderPage()
    expect(screen.getByRole('img', { name: 'Burnup for Platform, in tickets' })).toBeTruthy()
  })

  it('treats another team’s project as missing', () => {
    showing({ ...PLATFORM, team_id: 99 }, [])
    renderPage()
    expect(screen.getByText(/does not exist on Engineering/)).toBeTruthy()
  })
})

describe('changing the project', () => {
  it('saves the state, lead and target date as they change', async () => {
    showing(PLATFORM, [])
    const user = renderPage()

    await user.selectOptions(screen.getByLabelText('State'), 'completed')
    await user.selectOptions(screen.getByLabelText('Lead'), 'Ada Lovelace')

    expect(mocks.updateProject.mutateAsync.mock.calls.map(([call]) => call)).toEqual([
      { projectId: 5, data: { state: 'completed' } },
      { projectId: 5, data: { lead_id: 10 } },
    ])
  })

  it('clears the target date with null rather than an empty string', async () => {
    showing(PLATFORM, [])
    const user = renderPage()

    await user.clear(screen.getByLabelText('Target date'))
    expect(mocks.updateProject.mutateAsync).toHaveBeenLastCalledWith({
      projectId: 5,
      data: { target_date: null },
    })
  })
})

describe('moving tickets in and out', () => {
  it('removes a ticket by clearing its project, not by deleting it', async () => {
    showing(PLATFORM, [ticket(2, 'Write it', TODO)])
    const user = renderPage()

    await user.click(screen.getByRole('button', { name: 'Remove ENG-2 from Platform' }))
    expect(mocks.updateTicket.mutateAsync).toHaveBeenCalledWith({
      ticketId: 2,
      data: { project_id: null },
    })
  })

  it('opens a ticket in the panel without leaving the page', async () => {
    showing(PLATFORM, [ticket(2, 'Write it', TODO)])
    const user = renderPage()

    await user.click(screen.getByRole('button', { name: /Write it/ }))
    expect(screen.getByText('Panel for ticket 2')).toBeTruthy()
  })

  it('adds the tickets ticked in search, in one bulk edit', async () => {
    showing(PLATFORM, [ticket(2, 'Write it', TODO)])
    mocks.search.data = {
      items: [
        { id: 2, identifier: 'ENG-2', title: 'Write it' },
        { id: 8, identifier: 'ENG-8', title: 'Stray task' },
        { id: 9, identifier: 'ENG-9', title: 'Another' },
      ],
      total: 3,
    }
    const user = renderPage()

    await user.click(screen.getAllByRole('button', { name: 'Add tickets' })[0])
    const dialog = screen.getByRole('dialog', { name: 'Add tickets to Platform' })
    await user.type(within(dialog).getByRole('searchbox'), 'task')

    // Already in the project, so shown as such rather than offered again.
    const alreadyIn = await within(dialog).findByRole('checkbox', { name: /ENG-2/ })
    expect((alreadyIn as HTMLInputElement).disabled).toBe(true)

    await user.click(within(dialog).getByRole('checkbox', { name: /ENG-8/ }))
    await user.click(within(dialog).getByRole('checkbox', { name: /ENG-9/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 tickets' }))

    await waitFor(() =>
      expect(mocks.bulkUpdate.mutateAsync).toHaveBeenCalledWith({
        teamId: 7,
        data: { ticket_ids: [8, 9], changes: { project_id: 5 } },
      }),
    )
  })
})

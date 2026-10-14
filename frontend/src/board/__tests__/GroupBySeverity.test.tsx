// @vitest-environment jsdom
/**
 * The board by a bug's details (#273): a column per severity, worst first,
 * with every ticket that is not a rated bug in "No severity" -- and a bug's
 * card saying how bad beside how soon, unless its column already says it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { StatusRead, TicketRead } from '@/api/generated/models'
import { KanbanBoard } from '@/board/KanbanBoard'
import { TeamProvider } from '@/team/TeamContext'
import type { TeamContextValue } from '@/team/useTeamContext'

// The board asks who is signed in for its keyboard and selection affordances.
vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: { id: 10 } }),
}))

const TODO: StatusRead = { id: 1, team_id: 7, name: 'Todo', category: 'unstarted', position: 1, color: '#888' }

const TEAM: TeamContextValue = {
  team: { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' },
  teams: [],
  projects: [],
  labels: [],
  members: [],
  sprints: [],
  statuses: [TODO],
}

function ticket(id: number, title: string, fields: Partial<TicketRead>): TicketRead {
  return {
    id,
    team_id: 7,
    team_key: 'ENG',
    number: id,
    identifier: `ENG-${id}`,
    title,
    status: TODO,
    priority: 'no_priority',
    type: 'bug',
    rank: 'a0',
    blocked_by_count: 0,
    custom_fields: {},
    child_count: 0,
    completed_child_count: 0,
    creator: { id: 10, username: 'ada', full_name: 'Ada', avatar_color: '#123', is_active: true },
    labels: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...fields,
  } as TicketRead
}

const TICKETS = [
  ticket(1, 'Invoice PDF renders blank', { severity: 'major' }),
  ticket(2, 'Sign-in link works twice', { severity: 'critical' }),
  // A task that was a critical bug: its severity is not shown.
  ticket(3, 'Bump the PDF library', { type: 'task', severity: 'critical' }),
]

function renderBoard(grouping: 'status' | 'severity') {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamProvider value={TEAM}>
        <MemoryRouter>
          <KanbanBoard tickets={TICKETS} grouping={grouping} onStatusChange={() => {}} />
        </MemoryRouter>
      </TeamProvider>
    </QueryClientProvider>,
  )
}

afterEach(cleanup)

describe('the board by severity', () => {
  it('is a column per severity, worst first, with the rest in none', () => {
    renderBoard('severity')
    const names = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))
    expect(names).toEqual(['Critical', 'Major', 'Minor', 'Trivial', 'No severity'])
    const none = screen.getByRole('region', { name: 'No severity' })
    expect(within(none).getByText('Bump the PDF library')).toBeTruthy()
    // The column says it, so the card does not.
    expect(screen.queryByTitle('Severity: Critical')).toBeNull()
  })

  it('shows a bug’s severity on its card by status, and none on a task', () => {
    renderBoard('status')
    expect(screen.getByTitle('Severity: Critical')).toBeTruthy()
    expect(screen.getByTitle('Severity: Major')).toBeTruthy()
    expect(screen.getAllByTitle(/^Severity:/)).toHaveLength(2)
  })
})

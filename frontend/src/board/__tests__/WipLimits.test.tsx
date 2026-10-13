// @vitest-environment jsdom
/**
 * WIP limits on board columns (#270): a column counts against its limit and
 * says so in words when full or over; a drop announces what it does to the
 * column; the flow chart draws a stage's limit only where it has one.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EstimateSummary, StatusRead } from '@/api/generated/models'
import { KanbanBoard } from '@/board/KanbanBoard'
import { announcements } from '@/board/keyboardDrag'
import { arrival, standing } from '@/board/wip'
import { stageLimits } from '@/reports/stageLimits'
import { TeamProvider } from '@/team/TeamContext'
import type { TeamContextValue } from '@/team/useTeamContext'

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: { id: 10 } }),
}))

function status(id: number, name: string, wip_limit: number | null = null): StatusRead {
  return { id, team_id: 7, name, category: 'started', position: id, color: '#888', wip_limit }
}

const TODO = { ...status(1, 'Todo'), category: 'unstarted' as const }
const DOING = status(2, 'In Progress', 3)
const REVIEW = status(3, 'In Review', 2)

function load(wip_count: number) {
  return { points: 0, ticket_count: wip_count, unestimated_count: 0, wip_count }
}

const ESTIMATES = {
  total_points: 0,
  total_tickets: 7,
  by_status: { '1': load(1), '2': load(4), '3': load(2) },
  by_assignee: [],
} as unknown as EstimateSummary

function renderWith(node: ReactNode) {
  const value: TeamContextValue = {
    team: { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' },
    teams: [],
    projects: [],
    labels: [],
    members: [],
    sprints: [],
    statuses: [TODO, DOING, REVIEW],
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamProvider value={value}>
        <MemoryRouter>{node}</MemoryRouter>
      </TeamProvider>
    </QueryClientProvider>,
  )
}

afterEach(cleanup)

describe('a column against its limit', () => {
  it('counts the whole stage and says when it is over or full, in words', () => {
    renderWith(<KanbanBoard tickets={[]} estimates={ESTIMATES} onStatusChange={() => {}} />)
    const doing = within(screen.getByRole('region', { name: 'In Progress' }))
    expect(doing.getByText('4/3')).toBeTruthy()
    expect(doing.getByText('over by 1')).toBeTruthy()
    const review = within(screen.getByRole('region', { name: 'In Review' }))
    expect(review.getByText('2/2')).toBeTruthy()
    expect(review.getByText('full')).toBeTruthy()
    // No limit, no change: the cards it shows.
    const todo = within(screen.getByRole('region', { name: 'Todo' }))
    expect(todo.getByText('0')).toBeTruthy()
  })
})

describe('where a column stands', () => {
  it('is nothing without a limit, and room, full or over with one', () => {
    expect(standing(null, 4)).toBeNull()
    expect(standing(3, 2)?.state).toBe('room')
    expect(standing(3, 3)?.state).toBe('full')
    expect(standing(3, 5)).toEqual({ count: 5, limit: 3, state: 'over', overBy: 2 })
  })

  it('says what one more card would do', () => {
    const full = standing(3, 3)
    expect(arrival(standing(3, 2), { counts: true, hard: false })).toBeNull()
    expect(arrival(full, { counts: true, hard: false })).toEqual({ kind: 'over', count: 4, limit: 3 })
    expect(arrival(full, { counts: true, hard: true })).toEqual({ kind: 'refused' })
    // A sub-ticket where the team does not count them changes nothing.
    expect(arrival(full, { counts: false, hard: true })).toBeNull()
  })
})

describe('the words a drop is announced in', () => {
  const words = (limit: ReturnType<typeof arrival>) =>
    announcements({
      ticketName: () => 'ENG-24',
      columnName: () => 'In Progress',
      startColumn: () => 'Todo',
      drag: { moved: true },
      arriving: () => limit,
    }).onDragEnd!({ active: { id: 24 }, over: { id: 'status:2' } } as never)

  it('say the column is now over, where the team only warns', () => {
    expect(words({ kind: 'over', count: 4, limit: 3 })).toBe(
      'Moved ENG-24 to In Progress. In Progress is now over its limit, 4 of 3.',
    )
  })

  it('say the card stays, where the team refuses', () => {
    expect(words({ kind: 'refused' })).toBe('In Progress is full, so ENG-24 stays in Todo.')
  })

  it('are as before with room to spare', () => {
    expect(words(null)).toBe('Moved ENG-24 to In Progress.')
  })
})

describe('a stage on the flow chart', () => {
  it('has the sum of its columns’ limits, only where every column has one', () => {
    expect(stageLimits([TODO, DOING, REVIEW])).toEqual({ started: 5 })
    expect(stageLimits([DOING, status(4, 'QA')])).toEqual({})
  })
})

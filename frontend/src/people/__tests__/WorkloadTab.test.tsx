// @vitest-environment jsdom
/**
 * Workload (#127): somebody's open tickets by the teams you share, with each
 * team's totals as the server counted them, and each team paging on its own.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkloadRead, WorkloadTicket } from '@/api/generated/models'
import { WorkloadTab } from '@/people/WorkloadTab'

const mocks = vi.hoisted(() => ({ fetchPage: vi.fn() }))

vi.mock('@/api/generated/endpoints/people/people', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/people/people')>()),
  getWorkloadUsersUsernameWorkloadGet: (...args: unknown[]) => mocks.fetchPage(...args),
}))

const IN_PROGRESS = {
  id: 3,
  team_id: 7,
  name: 'In Progress',
  category: 'started',
  position: 2,
  color: '#f29d0b',
} as const
const BACKLOG = {
  ...IN_PROGRESS,
  id: 1,
  name: 'Backlog',
  category: 'backlog',
  color: '#9b98b0',
} as const

function ticket(number: number, overrides: Partial<WorkloadTicket> = {}): WorkloadTicket {
  return {
    id: number,
    team_key: 'ENG',
    number,
    identifier: `ENG-${number}`,
    title: `Ticket ${number}`,
    status: IN_PROGRESS,
    priority: 'high',
    estimate: 5,
    sprint: 'Sprint 14',
    ...overrides,
  }
}

const ENG = { id: 7, key: 'ENG', name: 'Engineering' }
const PLT = { id: 8, key: 'PLT', name: 'Platform' }

const WORKLOAD: WorkloadRead = {
  open_count: 9,
  points: 26,
  teams: [
    {
      team: ENG,
      open_count: 7,
      points: 18,
      tickets: [
        ticket(47, { title: 'Batch the notification digest' }),
        ticket(63, { status: BACKLOG, estimate: null, sprint: null, title: 'Paginate the log' }),
      ],
      offset: 0,
      limit: 2,
    },
    {
      team: PLT,
      open_count: 2,
      points: 8,
      tickets: [
        ticket(12, { team_key: 'PLT', identifier: 'PLT-12' }),
        ticket(19, { team_key: 'PLT', identifier: 'PLT-19' }),
      ],
      offset: 0,
      limit: 5,
    },
  ],
  reports: [],
}

function renderTab(workload: WorkloadRead, { isYou = false } = {}) {
  render(
    <MemoryRouter>
      <WorkloadTab username="daniel" name="Daniel Okafor" isYou={isYou} workload={workload} />
    </MemoryRouter>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.fetchPage.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('The Workload tab', () => {
  it('sums it up in the teams you share, with the points', () => {
    renderTab(WORKLOAD)
    expect(screen.getByText(/in the teams you share with Daniel Okafor/).textContent).toBe(
      '9 open tickets in the teams you share with Daniel Okafor · 26 points',
    )
  })

  it('groups by team, each with the totals the server counted', () => {
    renderTab(WORKLOAD)
    const eng = screen.getByRole('region', { name: 'Engineering' })
    expect(within(eng).getByText(/7 open/).textContent).toBe('7 open · 18 pts')
    const platform = screen.getByRole('region', { name: 'Platform' })
    expect(within(platform).getByText(/2 open/).textContent).toBe('2 open · 8 pts')
  })

  it('shows each ticket’s status, key, estimate and sprint, and links it', () => {
    renderTab(WORKLOAD)
    const eng = screen.getByRole('region', { name: 'Engineering' })
    const [first, second] = within(eng).getAllByRole('listitem')
    expect(first.textContent).toContain('In Progress')
    expect(first.textContent).toContain('ENG-47')
    expect(first.textContent).toContain('5 pts')
    expect(first.textContent).toContain('Sprint 14')
    expect(
      within(first)
        .getByRole('link', { name: 'Batch the notification digest' })
        .getAttribute('href'),
    ).toBe('/ENG/ticket/47')
    expect(second.textContent).toContain('No sprint')
    expect(within(second).getByTitle('Not sized').textContent).toBe('–')
  })

  it('shows the rest of one team on demand, from that team’s next page', async () => {
    mocks.fetchPage.mockResolvedValue({
      ...WORKLOAD,
      teams: [
        {
          ...WORKLOAD.teams[0],
          tickets: [3, 4, 5, 6, 7].map((n) => ticket(n)),
          offset: 2,
        },
      ],
    })
    const user = renderTab(WORKLOAD)
    const eng = screen.getByRole('region', { name: 'Engineering' })
    await user.click(within(eng).getByRole('button', { name: 'Show 5 more' }))

    expect(mocks.fetchPage).toHaveBeenCalledWith('daniel', {
      team_id: 7,
      offset: 2,
      per_team: 20,
    })
    expect(within(eng).getAllByRole('listitem')).toHaveLength(7)
    expect(within(eng).queryByRole('button', { name: /more/ })).toBeNull()
    // The other team is left as it was.
    expect(
      within(screen.getByRole('region', { name: 'Platform' })).queryByRole('button'),
    ).toBeNull()
  })

  it('says your own plate is yours', () => {
    renderTab(WORKLOAD, { isYou: true })
    expect(screen.getByText(/in your teams/).textContent).toBe(
      '9 open tickets in your teams · 26 points',
    )
  })

  it('says when nothing is open, and that done work does not count', () => {
    renderTab({ open_count: 0, points: 0, teams: [], reports: [] })
    expect(screen.getByText('Nothing open for Daniel Okafor in the teams you share.')).toBeTruthy()
    expect(screen.getByText('Done and cancelled tickets don’t count.')).toBeTruthy()
  })
})

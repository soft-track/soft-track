// @vitest-environment jsdom
/**
 * Sprint capacity (#269): the Plan tab's row per person with what is assigned
 * against what they can take, the unassigned row, scope beside capacity and
 * the line from history; and the dialog that sets capacity per person.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  EstimateUnit,
  PersonCapacity,
  SprintPlan,
  SprintRead,
  TeamMemberRead,
} from '@/api/generated/models'
import { PlanView } from '@/sprints/PlanView'
import { TeamProvider, type TeamContextValue } from '@/team/TeamContext'

const mocks = vi.hoisted(() => ({
  plan: null as SprintPlan | null,
  asked: [] as number[],
  save: vi.fn(),
  role: 'admin' as string,
}))

vi.mock('@/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 10 } }) }))
vi.mock('@/api/generated/endpoints/sprints/sprints', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/sprints/sprints')>()),
  useSprintPlanSprintsSprintIdPlanGet: (sprintId: number) => {
    mocks.asked.push(sprintId)
    return { data: mocks.plan, isError: false }
  },
  useSetCapacitySprintsSprintIdCapacityPut: () => ({ mutateAsync: mocks.save, isPending: false }),
}))

function person(
  id: number,
  full_name: string,
  overrides: Partial<PersonCapacity> = {},
): PersonCapacity {
  return {
    person: { id, username: full_name.split(' ')[0].toLowerCase(), full_name, avatar_color: '#123', is_active: true },
    days_here: 10,
    days_off: 0,
    tickets: 1,
    points_assigned: 3,
    points_capacity: 10,
    points_set: false,
    minutes_assigned: 0,
    minutes_capacity: 3600,
    minutes_set: false,
    ...overrides,
  }
}

const PLAN = (unit: EstimateUnit = 'points'): SprintPlan => ({
  sprint: {
    id: 15,
    display_name: 'Sprint 15',
    starts_at: '2026-10-05T00:00:00Z',
    ends_at: '2026-10-18T23:59:59Z',
    state: 'upcoming',
  },
  estimate_unit: unit,
  working_days: 10,
  default_points: 10,
  default_minutes_per_day: 360,
  people: [
    person(10, 'Amina Khan', { points_capacity: 6, points_set: true }),
    person(11, 'Daniel Okafor', { points_assigned: 13, minutes_assigned: 70 * 60 }),
    person(12, 'Mei Tanaka', {
      days_here: 8,
      days_off: 2,
      points_assigned: 8,
      points_capacity: 8,
      minutes_capacity: 2880,
    }),
  ],
  unassigned: { tickets: 2, points: 5, minutes: 0 },
  elsewhere: { tickets: 0, points: 0, minutes: 0 },
  scope_points: 29,
  capacity_points: 24,
  scope_minutes: 70 * 60,
  capacity_minutes: 3600 * 2 + 2880,
  history: [
    { sprint_id: 12, display_name: 'Sprint 12', points_planned: 36, points_delivered: 34, minutes_delivered: 0 },
    { sprint_id: 13, display_name: 'Sprint 13', points_planned: 40, points_delivered: 39, minutes_delivered: 0 },
    { sprint_id: 14, display_name: 'Sprint 14', points_planned: 41, points_delivered: 36, minutes_delivered: 0 },
  ],
  average_points: 36,
  average_minutes: 0,
})

function sprint(id: number, state: SprintRead['state']): SprintRead {
  return {
    id,
    team_id: 7,
    number: id,
    name: `Sprint ${id}`,
    display_name: `Sprint ${id}`,
    starts_at: '2026-10-05T00:00:00Z',
    ends_at: '2026-10-18T23:59:59Z',
    state,
    progress: { tickets_total: 0, tickets_completed: 0, points_total: 0, points_completed: 0, tickets_unestimated: 0 },
  }
}

function renderPlan(unit: EstimateUnit = 'points') {
  const member: TeamMemberRead = {
    role: mocks.role as TeamMemberRead['role'],
    joined_at: '2026-01-01T00:00:00Z',
    user: { id: 10, email: 'a@x.dev', username: 'amina', full_name: 'Amina Khan', avatar_color: '#123', is_active: true },
  }
  const team: TeamContextValue = {
    team: { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z', estimate_unit: unit },
    teams: [],
    projects: [],
    labels: [],
    members: [member],
    sprints: [sprint(14, 'active'), sprint(15, 'upcoming'), sprint(16, 'upcoming')],
    statuses: [],
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamProvider value={team}>
        <MemoryRouter>
          <PlanView />
        </MemoryRouter>
      </TeamProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.plan = PLAN()
  mocks.asked = []
  mocks.save.mockReset()
  mocks.role = 'admin'
})
afterEach(cleanup)

const rowOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement

describe('the plan', () => {
  it('plans the next sprint to start, not the one under way', () => {
    renderPlan()
    expect(mocks.asked.at(-1)).toBe(15)
  })

  it('shows assigned against capacity, the days here, and who is over', () => {
    renderPlan()
    expect(screen.getByText('29 of 24 pts')).toBeTruthy()
    expect(screen.getByText('scope against capacity')).toBeTruthy()

    const amina = rowOf('Amina Khan')
    expect(within(amina).getByText('3 / 6 pts')).toBeTruthy()
    expect(within(amina).getByText('room for 3')).toBeTruthy()
    expect(within(amina).getByText('10 of 10 days')).toBeTruthy()

    const daniel = rowOf('Daniel Okafor')
    expect(within(daniel).getByText('13 / 10 pts')).toBeTruthy()
    expect(within(daniel).getByText('over by 3')).toBeTruthy()

    expect(within(rowOf('Mei Tanaka')).getByText('8 of 10 days · away 2 days')).toBeTruthy()
  })

  it('has a row for the unassigned tickets, and the line from history', () => {
    renderPlan()
    expect(screen.getByText('Unassigned')).toBeTruthy()
    expect(screen.getByText('2 tickets in the sprint')).toBeTruthy()
    expect(screen.getByText('5 pts')).toBeTruthy()
    expect(
      screen.getByText('The last three sprints delivered 34, 39 and 36 points: 36 on average.'),
    ).toBeTruthy()
    expect(screen.getByText('average 36')).toBeTruthy()
  })

  it('reads in hours for a team that estimates in hours', () => {
    mocks.plan = PLAN('hours')
    renderPlan('hours')
    const daniel = rowOf('Daniel Okafor')
    expect(within(daniel).getByText('70h / 60h')).toBeTruthy()
    expect(within(daniel).getByText('over by 10h')).toBeTruthy()
  })

  it('lets a team that estimates in both choose', async () => {
    mocks.plan = PLAN('both')
    renderPlan('both')
    expect(within(rowOf('Daniel Okafor')).getByText('13 / 10 pts')).toBeTruthy()
    await userEvent.click(screen.getByRole('tab', { name: 'Hours' }))
    expect(within(rowOf('Daniel Okafor')).getByText('70h / 60h')).toBeTruthy()
  })

  it('does not offer a guest to set capacity', () => {
    mocks.role = 'guest'
    renderPlan()
    expect(screen.queryByRole('button', { name: 'Set capacity' })).toBeNull()
  })
})

describe('setting capacity', () => {
  it('starts from the default, follows the days, and keeps what was typed', async () => {
    mocks.save.mockResolvedValue(PLAN())
    renderPlan()
    await userEvent.click(screen.getByRole('button', { name: 'Set capacity' }))
    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).getByText(
        'Starts from the team’s default of 10 points and the days each person is here.',
      ),
    ).toBeTruthy()

    // Daniel is away a day: his capacity follows the days.
    const days = within(dialog).getByLabelText('Days Daniel Okafor is here')
    await userEvent.clear(days)
    await userEvent.type(days, '9')
    expect((within(dialog).getByLabelText('Capacity of Daniel Okafor') as HTMLInputElement).value).toBe('9')

    // Amina's was set by hand: the days do not move it.
    const aminaDays = within(dialog).getByLabelText('Days Amina Khan is here')
    await userEvent.clear(aminaDays)
    await userEvent.type(aminaDays, '5')
    expect((within(dialog).getByLabelText('Capacity of Amina Khan') as HTMLInputElement).value).toBe('6')

    // Mei's typed over.
    const mei = within(dialog).getByLabelText('Capacity of Mei Tanaka')
    await userEvent.clear(mei)
    await userEvent.type(mei, '4')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(mocks.save).toHaveBeenCalledWith({
      sprintId: 15,
      data: {
        people: [
          { user_id: 10, days_off: 5, points: 6 },
          // Left at what the default works out to: saved as the default.
          { user_id: 11, days_off: 1, points: null },
          { user_id: 12, days_off: 2, points: 4 },
        ],
      },
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('sets hours in minutes for a team that estimates in hours', async () => {
    mocks.plan = PLAN('hours')
    mocks.save.mockResolvedValue(PLAN('hours'))
    renderPlan('hours')
    await userEvent.click(screen.getByRole('button', { name: 'Set capacity' }))
    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).getByText(
        'Starts from the team’s default of 6h a day and the days each person is here.',
      ),
    ).toBeTruthy()
    const daniel = within(dialog).getByLabelText('Capacity of Daniel Okafor')
    await userEvent.clear(daniel)
    await userEvent.type(daniel, '32.5')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    const sent = mocks.save.mock.calls[0][0].data.people
    expect(sent[1]).toEqual({ user_id: 11, days_off: 0, minutes: 1950 })
    expect(sent[2]).toEqual({ user_id: 12, days_off: 2, minutes: null })
  })
})

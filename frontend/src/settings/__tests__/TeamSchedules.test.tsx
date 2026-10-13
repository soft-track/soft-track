// @vitest-environment jsdom
/**
 * Recurring tickets (#264): schedules beside the automation rules. Admins
 * add, pause and remove them; each says what it creates, when, where it
 * lands, and when it runs next -- or why it does not.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ScheduleRead } from '@/api/generated/models'
import { TeamSchedules } from '@/settings/TeamSchedules'

const AMINA = {
  id: 1,
  email: 'amina@example.com',
  username: 'amina',
  full_name: 'Amina Khan',
  avatar_color: '#123',
  is_active: true,
}
const DANIEL = { ...AMINA, id: 2, username: 'daniel', full_name: 'Daniel Okafor' }
const TEAM = { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' }
const MEMBERS = [
  { role: 'admin', joined_at: '2026-01-01T00:00:00Z', user: AMINA },
  { role: 'member', joined_at: '2026-01-01T00:00:00Z', user: DANIEL },
]

const mocks = vi.hoisted(() => ({
  schedules: [] as unknown[],
  create: { mutateAsync: vi.fn() },
  update: { mutateAsync: vi.fn() },
  remove: { mutateAsync: vi.fn() },
}))

vi.mock('@/api/generated/endpoints/schedules/schedules', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/schedules/schedules')>()),
  useListSchedulesTeamsTeamIdTicketSchedulesGet: () => ({
    data: mocks.schedules,
    isLoading: false,
  }),
  useCreateScheduleTeamsTeamIdTicketSchedulesPost: () => mocks.create,
  useUpdateScheduleTicketSchedulesScheduleIdPatch: () => mocks.update,
  useDeleteScheduleTicketSchedulesScheduleIdDelete: () => mocks.remove,
}))
vi.mock('@/api/generated/endpoints/templates/templates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/templates/templates')>()),
  useListTemplatesTeamsTeamIdTicketTemplatesGet: () => ({ data: [] }),
}))

function schedule(fields: Partial<ScheduleRead>): ScheduleRead {
  return {
    id: 1,
    team_id: 7,
    title: 'Dependency updates',
    frequency: 'weekly',
    weekdays: [0],
    interval: 1,
    type: 'task',
    created_by: AMINA,
    created_at: '2026-09-01T08:00:00Z',
    updated_at: '2026-09-01T08:00:00Z',
    created_count: 0,
    recent_tickets: [],
    ...fields,
  } as ScheduleRead
}

function renderPanel(isAdmin = true) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamSchedules
        team={TEAM}
        isAdmin={isAdmin}
        members={MEMBERS as never}
        labels={[]}
        projects={[]}
      />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.schedules = []
  for (const m of [mocks.create, mocks.update, mocks.remove]) {
    m.mutateAsync.mockReset().mockResolvedValue(undefined)
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TeamSchedules', () => {
  it('says what each creates, when, where it lands and what is next', () => {
    mocks.schedules = [
      schedule({
        assignee_id: 2,
        assignee: DANIEL,
        into_active_sprint: true,
        next_on: '2026-10-05',
        created_count: 14,
        recent_tickets: [{ id: 38, identifier: 'ENG-38', title: 'Dependency updates' }],
      }),
      schedule({
        id: 2,
        title: 'Month-end checks',
        frequency: 'monthly',
        weekdays: [],
        month_day: 'last_working_day',
        due_after_days: 2,
        wait_for_previous: true,
        waiting_on: { id: 40, identifier: 'ENG-40', title: 'Month-end checks' },
      }),
      schedule({
        id: 3,
        title: 'Accessibility pass',
        type: 'story',
        interval: 6,
        paused_at: '2026-09-12T10:00:00Z',
        paused_by: AMINA,
      }),
    ]
    renderPanel()

    expect(
      screen.getByText('Every Monday · a task for Daniel Okafor, in the active sprint'),
    ).toBeTruthy()
    expect(screen.getByText('Next on Mon 5 Oct · created 14 so far')).toBeTruthy()
    expect(
      screen.getByText(
        'Every month, on the last working day · a task, unassigned, in the backlog, due 2 days later',
      ),
    ).toBeTruthy()
    expect(
      screen.getByText('Waiting: ENG-40 is still open · only once the last is done'),
    ).toBeTruthy()
    expect(screen.getByText('Paused by Amina Khan on 12 Sep')).toBeTruthy()
    expect(
      (screen.getByRole('switch', { name: 'Accessibility pass is on' }) as HTMLInputElement)
        .checked,
    ).toBe(false)
  })

  it('pauses one from its switch', async () => {
    mocks.schedules = [schedule({ next_on: '2026-10-05' })]
    const user = renderPanel()
    await user.click(screen.getByRole('switch', { name: 'Dependency updates is on' }))
    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
      scheduleId: 1,
      data: { paused: true },
    })
  })

  it('lets an admin add one', async () => {
    const user = renderPanel()
    await user.click(screen.getByRole('button', { name: 'Add a schedule' }))
    const dialog = screen.getByRole('dialog', { name: 'New schedule' })
    await user.type(within(dialog).getByLabelText('What it creates'), 'Dependency updates')
    await user.selectOptions(within(dialog).getByLabelText('Assignee'), '2')
    await user.click(within(dialog).getByRole('button', { name: 'Thursday' }))
    await user.click(within(dialog).getByLabelText('Only once the previous one is done'))
    await user.click(within(dialog).getByRole('button', { name: 'Add schedule' }))

    await waitFor(() => expect(mocks.create.mutateAsync).toHaveBeenCalledTimes(1))
    const { teamId, data } = mocks.create.mutateAsync.mock.calls[0][0]
    expect(teamId).toBe(7)
    expect(data).toMatchObject({
      title: 'Dependency updates',
      assignee_id: 2,
      frequency: 'weekly',
      weekdays: [0, 3],
      wait_for_previous: true,
    })
  })

  it('removes one from its menu', async () => {
    mocks.schedules = [schedule({})]
    const user = renderPanel()
    await user.click(screen.getByRole('button', { name: 'More for Dependency updates' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }))
    expect(mocks.remove.mutateAsync).toHaveBeenCalledWith({ scheduleId: 1 })
  })

  it('leaves a member reading them', () => {
    mocks.schedules = [schedule({})]
    renderPanel(false)
    expect(screen.queryByRole('button', { name: 'Add a schedule' })).toBeNull()
    expect(
      (screen.getByRole('switch', { name: 'Dependency updates is on' }) as HTMLInputElement)
        .disabled,
    ).toBe(true)
  })
})

// @vitest-environment jsdom
/**
 * The filter menu and its chips, with filters that take several values
 * (#260): checkboxes where there was a select, a switch per filter that turns
 * it round, labels any or all, and a chip whose values come off one at a time.
 *
 * And the filters #261 added: created by, "me" as a value, updated and created
 * windows or dates, has no, and watching.
 *
 * The bar is controlled, so each test renders it inside a little holder that
 * keeps the filters it is handed back -- the way the board's URL does.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LabelRead, StatusRead, TeamMemberRead } from '@/api/generated/models'
import { FilterBar } from '@/board/FilterBar'
import { type BoardFilters, NO_FILTERS } from '@/board/filters'
import { TeamProvider, type TeamContextValue } from '@/team/TeamContext'

vi.mock('@/auth/useAuth', () => ({
  useAuth: () => ({ user: { id: 10, full_name: 'Amina Khan', avatar_color: '#123' } }),
}))

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

function status(id: number, name: string): StatusRead {
  return { id, team_id: 7, name, category: 'unstarted', position: id, color: '#888' }
}

const LABELS: LabelRead[] = [
  { id: 1, team_id: 7, name: 'Bug', color: '#f00' },
  { id: 2, team_id: 7, name: 'Feature', color: '#0f0' },
  { id: 3, team_id: 7, name: 'Design', color: '#00f' },
]

const TEAM = {
  team: { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' },
  teams: [],
  projects: [],
  labels: LABELS,
  members: [member(10, 'Amina Khan'), member(11, 'Daniel Okafor'), member(12, 'Mei Tanaka')],
  sprints: [],
  statuses: [status(1, 'Todo'), status(5, 'Done')],
} as unknown as TeamContextValue

let latest: BoardFilters = NO_FILTERS

function Holder({ initial }: { initial: BoardFilters }) {
  const [filters, setFilters] = useState(initial)
  return (
    <FilterBar
      filters={filters}
      onChange={(next) => {
        latest = next
        setFilters(next)
      }}
      onSave={vi.fn()}
      canSave={false}
    />
  )
}

function renderBar(initial: BoardFilters = NO_FILTERS) {
  latest = initial
  render(
    <TeamProvider value={TEAM}>
      <Holder initial={initial} />
    </TeamProvider>,
  )
  return userEvent.setup()
}

const menu = () => screen.getByRole('dialog', { name: 'Filter tickets' })

async function openSection(user: ReturnType<typeof userEvent.setup>, field: string) {
  await user.click(screen.getByRole('button', { name: /^Filter/ }))
  await user.click(within(menu()).getByRole('button', { name: new RegExp(`^${field}`) }))
}

afterEach(cleanup)

describe('FilterBar', () => {
  it('ticks several people, who are alternatives in one chip', async () => {
    const user = renderBar()
    await openSection(user, 'Assignee')

    await user.click(within(menu()).getByRole('checkbox', { name: 'Mei Tanaka' }))
    await user.click(within(menu()).getByRole('checkbox', { name: 'Daniel Okafor' }))

    // In the menu's order, whichever was ticked first.
    expect(latest.assignee).toEqual({ values: [11, 12], exclude: false })
    expect(screen.getByTestId('filter-chip-assignee').textContent).toBe(
      'AssigneeDaniel OkafororMei Tanaka',
    )
  })

  it('offers nobody as one of the assignee choices', async () => {
    const user = renderBar()
    await openSection(user, 'Assignee')
    await user.click(within(menu()).getByRole('checkbox', { name: 'Unassigned' }))
    expect(latest.assignee.values).toEqual(['unassigned'])
  })

  it('turns a filter round with its switch', async () => {
    const user = renderBar()
    await openSection(user, 'Status')
    await user.click(within(menu()).getByRole('checkbox', { name: 'Done' }))
    await user.click(within(menu()).getByRole('switch', { name: 'Every status except these' }))

    expect(latest.status).toEqual({ values: [5], exclude: true })
    expect(screen.getByTestId('filter-chip-status').textContent).toBe('StatusnotDone')
  })

  it('asks labels any or all', async () => {
    const user = renderBar()
    await openSection(user, 'Label')
    await user.click(within(menu()).getByRole('checkbox', { name: 'Bug' }))
    await user.click(within(menu()).getByRole('checkbox', { name: 'Design' }))
    await user.click(within(menu()).getByRole('radio', { name: 'All of these' }))

    expect(latest.label).toEqual({ values: [1, 3], exclude: false, match: 'all' })
    expect(screen.getByTestId('filter-chip-label').textContent).toBe('LabelBugandDesign')
  })

  it('removes one value from a chip and keeps the others', async () => {
    const user = renderBar({
      ...NO_FILTERS,
      assignee: { values: [11, 12], exclude: false },
      type: { values: ['bug', 'story'], exclude: false },
    })

    await user.click(
      screen.getByRole('button', { name: 'Remove Mei Tanaka from the Assignee filter' }),
    )
    expect(latest.assignee).toEqual({ values: [11], exclude: false })
    expect(latest.type.values).toEqual(['bug', 'story'])
  })

  it('clears everything at once', async () => {
    const user = renderBar({ ...NO_FILTERS, type: { values: ['bug'], exclude: true } })
    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(latest).toEqual(NO_FILTERS)
  })

  it('opens on the first filter that is set', async () => {
    const user = renderBar({ ...NO_FILTERS, type: { values: ['bug'], exclude: false } })
    await user.click(screen.getByRole('button', { name: /^Filter/ }))
    expect(within(menu()).getByRole('checkbox', { name: 'Bug' })).toHaveProperty('checked', true)
  })

  it('offers me as an assignee, which is whoever is looking', async () => {
    const user = renderBar()
    await openSection(user, 'Assignee')
    await user.click(within(menu()).getByRole('checkbox', { name: 'Me' }))
    expect(latest.assignee.values).toEqual(['me'])
    expect(screen.getByTestId('filter-chip-assignee').textContent).toBe('AssigneeMe')
  })

  it('filters by who created a ticket, people or me', async () => {
    const user = renderBar()
    await openSection(user, 'Created by')
    await user.click(within(menu()).getByRole('checkbox', { name: 'Amina Khan' }))
    await user.click(within(menu()).getByRole('checkbox', { name: 'Me' }))
    expect(latest.creator).toEqual({ values: ['me', 10], exclude: false })
    expect(screen.getByTestId('filter-chip-creator').textContent).toBe(
      'Created byMeorAmina Khan',
    )
  })

  it('narrows to what changed more than 30 days ago, and unticks it', async () => {
    const user = renderBar()
    await openSection(user, 'Updated')
    const listbox = within(menu()).getByRole('listbox', { name: 'Updated' })
    await user.click(within(listbox).getByRole('option', { name: 'More than 30 days ago' }))

    expect(latest.updated).toEqual({ window: 'over_30_days', from: null, to: null })
    expect(screen.getByTestId('filter-chip-updated').textContent).toBe(
      'Updatedmore than 30 days ago',
    )
    expect(
      within(listbox).getByRole('option', { name: 'More than 30 days ago' }),
    ).toHaveProperty('ariaSelected', 'true')

    await user.click(within(listbox).getByRole('option', { name: 'More than 30 days ago' }))
    expect(latest.updated).toEqual({ window: null, from: null, to: null })
  })

  it('takes a date for before, and names the day that was picked', async () => {
    const user = renderBar()
    await user.click(screen.getByRole('button', { name: /^Filter/ }))
    await user.click(within(menu()).getByRole('button', { name: /^Created(?! by)/ }))
    await user.click(within(menu()).getByRole('option', { name: 'Before a date…' }))
    const field = within(menu()).getByLabelText('Date')
    await user.type(field, '2026-09-03')

    // Both ends of the API's range are included: before the 3rd is to the 2nd.
    expect(latest.created).toEqual({ window: null, from: null, to: '2026-09-02' })
    expect(screen.getByTestId('filter-chip-created').textContent).toBe(
      'Createdbefore 3 Sep 2026',
    )
  })

  it('asks for tickets with no estimate, and only those I watch', async () => {
    const user = renderBar()
    await openSection(user, 'Has no')
    await user.click(within(menu()).getByRole('checkbox', { name: 'estimate' }))
    await user.click(within(menu()).getByRole('button', { name: /^Watching/ }))
    await user.click(
      within(menu()).getByRole('checkbox', { name: 'Only tickets I am watching' }),
    )

    expect(latest.hasNo).toEqual(['estimate'])
    expect(latest.watching).toBe(true)
    expect(screen.getByTestId('filter-chip-hasNo').textContent).toBe('Has noestimate')
    expect(screen.getByTestId('filter-chip-watching').textContent).toBe('Watched byme')
  })
})

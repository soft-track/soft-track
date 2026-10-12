// @vitest-environment jsdom
/**
 * The filter menu and its chips, with filters that take several values
 * (#260): checkboxes where there was a select, a switch per filter that turns
 * it round, labels any or all, and a chip whose values come off one at a time.
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
})

// @vitest-environment jsdom
/**
 * A bug's properties (#273): severity, environment, found in and fixed in,
 * after its type -- and the fix version of any ticket (#272), only for a
 * team that ships releases.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ReleaseRead, TicketRead } from '@/api/generated/models'
import { TeamProvider } from '@/team/TeamContext'
import type { TeamContextValue } from '@/team/useTeamContext'
import { TicketProperties } from '@/tickets/detail/TicketProperties'

function release(id: number, name: string, state: ReleaseRead['state'] = 'planned'): ReleaseRead {
  return {
    id,
    team_id: 7,
    name,
    state,
    created_at: '2026-01-01T00:00:00Z',
    progress: {
      tickets_total: 0,
      tickets_done: 0,
      points_total: 0,
      points_done: 0,
      tickets_unestimated: 0,
    },
  }
}

const ticket = (over: Partial<TicketRead> = {}) =>
  ({
    id: 9,
    status: { id: 3, name: 'In Progress', category: 'started' },
    priority: 'no_priority',
    type: 'bug',
    estimate: null,
    severity: 'major',
    environment: 'Demo',
    found_in_id: 3,
    fix_version_id: 4,
    ...over,
  }) as TicketRead

function renderProperties(t: TicketRead, releases: ReleaseRead[] = [release(4, '1.4.0'), release(3, '1.3.2', 'released')]) {
  const patch = vi.fn().mockResolvedValue(undefined)
  const team: TeamContextValue = {
    team: {
      id: 7,
      name: 'Engineering',
      key: 'ENG',
      created_at: '2026-01-01T00:00:00Z',
      environments: ['Production', 'Staging'],
    },
    teams: [],
    projects: [],
    labels: [],
    members: [],
    sprints: [],
    statuses: [{ id: 3, team_id: 7, name: 'In Progress', category: 'started', position: 1, color: '#888' }],
    releases,
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamProvider value={team}>
        <MemoryRouter>
          <TicketProperties ticket={t} patch={patch} currentLabelIds={new Set()} onToggleLabel={() => {}} />
        </MemoryRouter>
      </TeamProvider>
    </QueryClientProvider>,
  )
  return { user: userEvent.setup(), patch }
}

const value = (name: string) => {
  const select = screen.getByRole('combobox', { name }) as HTMLSelectElement
  return select.options[select.selectedIndex].text
}

afterEach(cleanup)

describe('a bug’s properties', () => {
  it('shows how bad, where, found in and fixed in', () => {
    renderProperties(ticket())
    expect(value('Severity')).toBe('Major')
    // An environment the team has taken off its list stays on the bug.
    expect(value('Environment')).toBe('Demo')
    expect(value('Found in')).toBe('1.3.2')
    expect(value('Fixed in')).toBe('1.4.0')
    expect(screen.queryByRole('combobox', { name: 'Fix version' })).toBeNull()
  })

  it('changes the severity on its own', async () => {
    const { user, patch } = renderProperties(ticket())
    await user.selectOptions(screen.getByRole('combobox', { name: 'Severity' }), 'critical')
    expect(patch).toHaveBeenCalledWith({ severity: 'critical' })
  })

  it('hides what a task kept from when it was a bug, and calls it a fix version', () => {
    renderProperties(ticket({ type: 'task' }))
    expect(screen.queryByRole('combobox', { name: 'Severity' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Found in' })).toBeNull()
    expect(value('Fix version')).toBe('1.4.0')
  })

  it('asks a team with no releases nothing about one', () => {
    renderProperties(ticket({ type: 'task', fix_version_id: null }), [])
    expect(screen.queryByRole('combobox', { name: 'Fix version' })).toBeNull()
  })
})

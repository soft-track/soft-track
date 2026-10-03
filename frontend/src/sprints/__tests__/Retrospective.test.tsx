// @vitest-environment jsdom
/**
 * A sprint's goal and retrospective (#271): completing asks whether the goal
 * was met and for the retrospective; the retrospective is written later by
 * anybody but a guest, a line of "what to change" becomes a ticket, and a
 * team admin closes it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SprintRead, TeamMemberRead } from '@/api/generated/models'
import { CompleteSprintDialog } from '@/sprints/CompleteSprintDialog'
import { RetrospectivePanel } from '@/sprints/RetrospectivePanel'
import { actionLines } from '@/sprints/retro'
import { TeamProvider, type TeamContextValue } from '@/team/TeamContext'

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  update: vi.fn(),
  close: vi.fn(),
  act: vi.fn(),
  role: 'admin' as string,
}))

vi.mock('@/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 10 } }) }))
vi.mock('@/api/generated/endpoints/sprints/sprints', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/sprints/sprints')>()),
  useCompleteSprintSprintsSprintIdCompletePost: () => ({ mutateAsync: mocks.complete, isPending: false }),
  useUpdateRetrospectiveSprintsSprintIdRetrospectivePatch: () => ({ mutateAsync: mocks.update, isPending: false }),
  useCloseRetrospectiveSprintsSprintIdRetrospectiveClosePost: () => ({ mutateAsync: mocks.close, isPending: false }),
  useCreateRetroActionSprintsSprintIdRetrospectiveActionsPost: () => ({ mutateAsync: mocks.act, isPending: false }),
}))

const AMINA = (): TeamMemberRead => ({
  role: mocks.role as TeamMemberRead['role'],
  joined_at: '2026-01-01T00:00:00Z',
  user: { id: 10, email: 'a@x.dev', username: 'amina', full_name: 'Amina Khan', avatar_color: '#123', is_active: true },
})

const SPRINT: SprintRead = {
  id: 14,
  team_id: 7,
  number: 14,
  name: 'Sprint 14',
  display_name: 'Sprint 14',
  starts_at: '2026-09-21T00:00:00Z',
  ends_at: '2026-10-04T23:59:59Z',
  state: 'completed',
  progress: { tickets_total: 6, tickets_completed: 3, points_total: 22, points_completed: 13, tickets_unestimated: 0 },
  goal: 'A customer can sign in and see their invoices.',
  goal_outcome: 'partly',
  retrospective: {
    went_well: 'Sign-in shipped on day six.',
    did_not: null,
    to_change: '- Regression pass starts on day seven.\n- Review requests wait no more than a day.',
    closed_at: null,
    actions: [
      { id: 1, text: 'Review requests wait no more than a day.', ticket_id: 41, identifier: 'ENG-41', created_at: '2026-10-04T10:00:00Z' },
    ],
  },
}

function renderWith(node: React.ReactNode) {
  const team: TeamContextValue = {
    team: { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' },
    teams: [],
    projects: [],
    labels: [],
    members: [AMINA()],
    sprints: [],
    statuses: [],
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamProvider value={team}>
        <MemoryRouter>{node}</MemoryRouter>
      </TeamProvider>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.role = 'admin'
  for (const fn of [mocks.complete, mocks.update, mocks.close, mocks.act]) fn.mockReset().mockResolvedValue({})
})
afterEach(cleanup)

describe('the lines of what to change', () => {
  it('are one per line, without list markers or task boxes', () => {
    expect(actionLines('- One\n\n* Two \n1. Three\n- [ ] Four\nFive')).toEqual([
      'One',
      'Two',
      'Three',
      'Four',
      'Five',
    ])
  })
})

describe('completing a sprint', () => {
  it('asks whether the goal was met and for the retrospective, and sends both', async () => {
    const user = renderWith(
      <CompleteSprintDialog
        sprint={{ ...SPRINT, state: 'active', goal_outcome: null, retrospective: null }}
        onClose={vi.fn()}
        onCompleted={vi.fn()}
      />,
    )
    expect(screen.getByText(/13 of 22 points are done/)).toBeTruthy()
    expect(screen.getByText('A customer can sign in and see their invoices.')).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: 'Partly' }))
    await user.type(screen.getByRole('textbox', { name: 'What went well' }), 'Sign-in on day six')
    await user.click(screen.getByRole('button', { name: 'Complete sprint' }))
    expect(mocks.complete).toHaveBeenCalledWith({
      sprintId: 14,
      data: { outcome: 'partly', went_well: 'Sign-in on day six', did_not: null, to_change: null },
    })
  })
})

describe('the retrospective', () => {
  it('shows each section, and which actions became tickets', () => {
    renderWith(<RetrospectivePanel sprint={SPRINT} />)
    expect(
      screen.getByRole<HTMLSelectElement>('combobox', { name: 'How did the goal go?' }).value,
    ).toBe('partly')
    expect(screen.getByText('Sign-in shipped on day six.')).toBeTruthy()
    const made = screen.getByText('Review requests wait no more than a day.').closest('li') as HTMLElement
    expect(within(made).getByRole('link', { name: 'ENG-41' }).getAttribute('href')).toBe('/ENG/ticket/41')
    const notYet = screen.getByText('Regression pass starts on day seven.').closest('li') as HTMLElement
    expect(within(notYet).getByRole('button', { name: 'Make a ticket' })).toBeTruthy()
  })

  it('makes a ticket of a line with one click', async () => {
    const user = renderWith(<RetrospectivePanel sprint={SPRINT} />)
    await user.click(screen.getByRole('button', { name: 'Make a ticket' }))
    expect(mocks.act).toHaveBeenCalledWith({
      sprintId: 14,
      data: { text: 'Regression pass starts on day seven.' },
    })
  })

  it('saves a section written later', async () => {
    const user = renderWith(<RetrospectivePanel sprint={SPRINT} />)
    await user.click(screen.getByRole('button', { name: 'Edit Did not' }))
    await user.type(screen.getByRole('textbox', { name: 'What did not' }), 'The PDF bug came late.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({ sprintId: 14, data: { did_not: 'The PDF bug came late.' } }),
    )
  })

  it('is closed by a team admin, and read-only after', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = renderWith(<RetrospectivePanel sprint={SPRINT} />)
    await user.click(screen.getByRole('button', { name: 'Close retrospective' }))
    expect(mocks.close).toHaveBeenCalledWith({ sprintId: 14 })
    cleanup()

    renderWith(
      <RetrospectivePanel
        sprint={{ ...SPRINT, retrospective: { ...SPRINT.retrospective!, closed_at: '2026-10-05T09:00:00Z' } }}
      />,
    )
    expect(screen.getByText('Closed 5 Oct 2026')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull()
  })

  it('offers a guest nothing to change', () => {
    mocks.role = 'guest'
    renderWith(<RetrospectivePanel sprint={SPRINT} />)
    expect(screen.getByText('Goal partly met')).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Make a ticket' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Close retrospective' })).toBeNull()
  })
})

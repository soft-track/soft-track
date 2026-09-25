// @vitest-environment jsdom
/**
 * Selecting issues in the list and acting on them from the bulk bar.
 *
 * The harness wires the list, the selection reducer, `useBulkEdit` and the
 * bar together the way BoardPage does, so a test clicks rows and picks from
 * the bar and sees exactly what would be sent. The generated mutation hooks
 * are replaced at the module boundary.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useReducer } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IssueRead, StatusRead, TeamMemberRead } from '@/api/generated/models'
import { BulkActionBar } from '@/board/BulkActionBar'
import { IssueListView } from '@/board/IssueListView'
import { EMPTY_SELECTION, selectionReducer } from '@/board/selection'
import { useBulkEdit } from '@/board/useBulkEdit'
import { TeamProvider } from '@/team/TeamContext'
import type { TeamContextValue } from '@/team/useTeamContext'

const { update, remove } = vi.hoisted(() => ({
  update: { mutateAsync: vi.fn(), isPending: false },
  remove: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock('@/api/generated/endpoints/issues/issues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/issues/issues')>()),
  useBulkUpdateIssuesTeamsTeamIdIssuesBulkUpdatePost: () => update,
  useBulkDeleteIssuesTeamsTeamIdIssuesBulkDeletePost: () => remove,
}))

function status(id: number, name: string): StatusRead {
  return { id, team_id: 7, name, category: 'unstarted', position: id, color: '#888' }
}

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

const TODO = status(1, 'Todo')

const TEAM: TeamContextValue = {
  team: { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' },
  teams: [],
  projects: [],
  labels: [{ id: 40, team_id: 7, name: 'Bug', color: '#f00' }],
  members: [member(10, 'Ada Lovelace')],
  cycles: [],
  statuses: [TODO, status(2, 'In Progress')],
}

function issue(id: number, title: string): IssueRead {
  const user = member(10, 'Ada Lovelace').user
  return {
    id,
    team_id: 7,
    team_key: 'ENG',
    number: id,
    identifier: `ENG-${id}`,
    title,
    status: TODO,
    priority: 'no_priority',
    blocked_by_count: 0,
    child_count: 0,
    completed_child_count: 0,
    creator: user,
    labels: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

const ISSUES = [issue(1, 'First'), issue(2, 'Second'), issue(3, 'Third'), issue(4, 'Fourth')]

function Board() {
  const [selection, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION)
  const bulk = useBulkEdit(TEAM.team)
  return (
    <>
      <IssueListView
        issues={ISSUES}
        selectedIds={selection.ids}
        onSelect={(id, gesture, order) =>
          dispatch(gesture === 'range' ? { type: 'range', id, order } : { type: 'toggle', id })
        }
      />
      {selection.ids.length > 0 && (
        <BulkActionBar
          selectedIds={selection.ids}
          bulk={bulk}
          onClear={() => dispatch({ type: 'clear' })}
        />
      )}
    </>
  )
}

function renderBoard() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamProvider value={TEAM}>
        <MemoryRouter initialEntries={['/ENG']}>
          <Routes>
            <Route path="/ENG" element={<Board />} />
            <Route path="/ENG/issue/:number" element={<p>Opened an issue</p>} />
          </Routes>
        </MemoryRouter>
      </TeamProvider>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const row = (title: string) => screen.getByRole('button', { name: new RegExp(title) })
const bar = () => screen.getByRole('toolbar', { name: 'Bulk actions' })

async function pick(user: ReturnType<typeof userEvent.setup>, ...titles: string[]) {
  await user.keyboard('{Control>}')
  for (const title of titles) await user.click(row(title))
  await user.keyboard('{/Control}')
}

beforeEach(() => {
  update.mutateAsync.mockReset().mockResolvedValue([])
  remove.mutateAsync.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('selecting issues', () => {
  it('ctrl-click toggles rows in and out of the selection', async () => {
    const user = renderBoard()
    await pick(user, 'First', 'Third')
    expect(within(bar()).getByText('2 selected')).toBeTruthy()

    await pick(user, 'First')
    expect(within(bar()).getByText('1 selected')).toBeTruthy()
  })

  it('shift-click selects the range in between', async () => {
    const user = renderBoard()
    await pick(user, 'First')
    await user.keyboard('{Shift>}')
    await user.click(row('Third'))
    await user.keyboard('{/Shift}')

    expect(within(bar()).getByText('3 selected')).toBeTruthy()
    expect(row('Fourth').hasAttribute('data-selected')).toBe(false)
  })

  it('a plain click still opens the issue', async () => {
    const user = renderBoard()
    await user.click(row('Second'))
    expect(screen.getByText('Opened an issue')).toBeTruthy()
  })

  it('shows no bar until something is selected', () => {
    renderBoard()
    expect(screen.queryByRole('toolbar')).toBeNull()
  })
})

describe('the bulk bar', () => {
  it('sends one request for the whole selection', async () => {
    const user = renderBoard()
    await pick(user, 'First', 'Second', 'Fourth')
    await user.selectOptions(screen.getByLabelText('Set status'), 'In Progress')

    expect(update.mutateAsync).toHaveBeenCalledTimes(1)
    expect(update.mutateAsync).toHaveBeenCalledWith({
      teamId: 7,
      data: { issue_ids: [1, 2, 4], changes: { status_id: 2 } },
    })
  })

  it('sends an explicit null to unassign', async () => {
    const user = renderBoard()
    await pick(user, 'First')
    await user.selectOptions(screen.getByLabelText('Set assignee'), 'Unassigned')

    expect(update.mutateAsync).toHaveBeenCalledWith({
      teamId: 7,
      data: { issue_ids: [1], changes: { assignee_id: null } },
    })
  })

  it('adds and removes labels rather than replacing them', async () => {
    const user = renderBoard()
    await pick(user, 'First')
    const labels = screen.getByLabelText('Add or remove a label')

    await user.selectOptions(labels, 'add:40')
    await user.selectOptions(labels, 'remove:40')

    expect(update.mutateAsync.mock.calls.map(([args]) => args.data.changes)).toEqual([
      { add_label_ids: [40] },
      { remove_label_ids: [40] },
    ])
  })

  it('shows why a batch was refused and keeps the selection', async () => {
    update.mutateAsync.mockRejectedValue({
      response: { data: { detail: 'No such status on this team' } },
    })
    const user = renderBoard()
    await pick(user, 'First', 'Second')
    await user.selectOptions(screen.getByLabelText('Set status'), 'Todo')

    expect((await screen.findByRole('alert')).textContent).toBe('No such status on this team')
    expect(within(bar()).getByText('2 selected')).toBeTruthy()
  })
})

describe('bulk delete', () => {
  it('asks first, and sends nothing when the answer is no', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = renderBoard()
    await pick(user, 'First', 'Second')
    await user.click(within(bar()).getByRole('button', { name: /Delete/ }))

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Delete 2 issues?'))
    expect(remove.mutateAsync).not.toHaveBeenCalled()
    expect(bar()).toBeTruthy()
  })

  it('deletes the selection in one request and clears it', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = renderBoard()
    await pick(user, 'First', 'Third')
    await user.click(within(bar()).getByRole('button', { name: /Delete/ }))

    expect(remove.mutateAsync).toHaveBeenCalledTimes(1)
    expect(remove.mutateAsync).toHaveBeenCalledWith({ teamId: 7, data: { issue_ids: [1, 3] } })
    await waitFor(() => expect(screen.queryByRole('toolbar')).toBeNull())
  })
})

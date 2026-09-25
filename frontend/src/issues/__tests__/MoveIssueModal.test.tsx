// @vitest-environment jsdom
/**
 * Moving an issue to another team (#98): the server's plan, said in plain
 * sentences before anything moves, then the move and a trip to the new key.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IssueRead, TeamRead, TransferPlan } from '@/api/generated/models'
import { MoveIssueModal, PlanSummary } from '@/issues/MoveIssueModal'

const mocks = vi.hoisted(() => ({
  preview: { data: undefined as unknown, isLoading: false, error: null as unknown },
  previewArgs: [] as unknown[],
  transfer: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock('@/api/generated/endpoints/issues/issues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/issues/issues')>()),
  usePreviewTransferIssuesIssueIdTransferGet: (...args: unknown[]) => {
    mocks.previewArgs = args
    return mocks.preview
  },
  useTransferIssueIssuesIssueIdTransferPost: () => mocks.transfer,
}))

const OPS: TeamRead = { id: 8, name: 'Operations', key: 'OPS', created_at: '2026-01-01T00:00:00Z' }
const SEC: TeamRead = { id: 9, name: 'Security', key: 'SEC', created_at: '2026-01-01T00:00:00Z' }
const ISSUE = { id: 42, team_id: 7, identifier: 'ENG-42', number: 42 } as IssueRead

const PLAN: TransferPlan = {
  from_identifier: 'ENG-42',
  to_identifier: 'OPS-17',
  status: { from_name: 'In Review', to_name: 'In Progress', same_category: true },
  labels_kept: ['bug'],
  labels_dropped: ['frontend', 'design'],
  cycle_cleared: 'Sprint 4',
  project_cleared: null,
  assignee_cleared: 'Maya Chen',
  parent_detached: null,
  sub_issues: ['ENG-43'],
}

function renderModal(teams: TeamRead[] = [OPS]) {
  const onClose = vi.fn()
  const onWindowEscape = vi.fn()
  const listener = (e: KeyboardEvent) => e.key === 'Escape' && onWindowEscape()
  window.addEventListener('keydown', listener)
  teardown.push(() => window.removeEventListener('keydown', listener))
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/ENG/issue/42']}>
        <Routes>
          <Route
            path="/ENG/issue/42"
            element={<MoveIssueModal issue={ISSUE} teams={teams} onClose={onClose} />}
          />
          <Route path="/OPS/issue/:n" element={<p>Opened OPS issue</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { onClose, onWindowEscape, user: userEvent.setup() }
}

const teardown: Array<() => void> = []

beforeEach(() => {
  mocks.preview = { data: PLAN, isLoading: false, error: null }
  mocks.transfer.mutateAsync.mockReset()
})

afterEach(() => {
  teardown.splice(0).forEach((undo) => undo())
  cleanup()
})

describe('MoveIssueModal', () => {
  it('asks for nothing but a team when there is only one to go to, and shows the plan', () => {
    renderModal()
    expect(screen.getByRole('dialog', { name: 'Move ENG-42 to another team' })).toBeTruthy()
    expect(mocks.previewArgs.slice(0, 2)).toEqual([42, { team_id: 8 }])
    expect(screen.getByText('ENG-42 becomes OPS-17.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Move to OPS' })).toBeTruthy()
  })

  it('waits for a choice when there are several teams', async () => {
    mocks.preview = { data: undefined, isLoading: false, error: null }
    const { user } = renderModal([OPS, SEC])
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Move' }).disabled).toBe(true)

    mocks.preview = { data: PLAN, isLoading: false, error: null }
    await user.selectOptions(screen.getByRole('combobox'), 'Operations (OPS)')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Move to OPS' }).disabled).toBe(false)
  })

  it('moves, then opens the issue under its new key', async () => {
    mocks.transfer.mutateAsync.mockResolvedValue({
      issue: { ...ISSUE, team_id: 8, team_key: 'OPS', number: 17, identifier: 'OPS-17' },
      sub_issues: [],
    })
    const { onClose, user } = renderModal()
    await user.click(screen.getByRole('button', { name: 'Move to OPS' }))
    expect(mocks.transfer.mutateAsync).toHaveBeenCalledWith({ issueId: 42, data: { team_id: 8 } })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(await screen.findByText('Opened OPS issue')).toBeTruthy()
  })

  it('says why when the server refuses the preview', () => {
    mocks.preview = {
      data: undefined,
      isLoading: false,
      error: { response: { data: { code: 'team_read_only', detail: 'x' } } },
    }
    renderModal()
    expect(screen.getByRole('alert').textContent).toMatch(/guest on this team/)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Move to OPS' }).disabled).toBe(true)
  })

  it('closes on Escape without the Escape reaching the issue panel behind it', async () => {
    const { onClose, onWindowEscape, user } = renderModal()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onWindowEscape).not.toHaveBeenCalled()
  })
})

describe('PlanSummary', () => {
  it('says what changes, then what is lost', () => {
    render(<PlanSummary plan={PLAN} />)
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'ENG-42 becomes OPS-17.',
      'Moves from In Review to In Progress.',
      'Keeps bug.',
      'Loses frontend and design — no label by that name there.',
      'Leaves Sprint 4; cycles belong to one team.',
      'Is unassigned from Maya Chen, who is not on that team.',
      'Takes its sub-issue ENG-43 with it.',
    ])
  })

  it('says when the status had no equivalent', () => {
    render(
      <PlanSummary
        plan={{
          ...PLAN,
          status: { from_name: 'In Review', to_name: 'Backlog', same_category: false },
          labels_kept: [],
          labels_dropped: [],
          cycle_cleared: null,
          assignee_cleared: null,
          parent_detached: 'ENG-40',
          sub_issues: [],
        }}
      />,
    )
    expect(screen.getByText(/that team has no column like it/)).toBeTruthy()
    expect(screen.getByText('Stops being a sub-issue of ENG-40.')).toBeTruthy()
  })
})

// @vitest-environment jsdom
/**
 * Time on an issue (#102): the total, whose it was, logging more, and
 * changing only your own.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { localToday } from '@/issues/dueDate'
import { TimeSection } from '@/issues/detail/TimeSection'

const ME = { id: 1, full_name: 'Olivia Owner', avatar_color: '#123', is_active: true }
const MAYA = { id: 2, full_name: 'Maya Chen', avatar_color: '#456', is_active: true }

const mocks = vi.hoisted(() => ({
  time: { data: undefined as unknown },
  create: { mutateAsync: vi.fn(), isPending: false },
  update: { mutateAsync: vi.fn(), isPending: false },
  remove: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: ME }),
}))
vi.mock('@/api/generated/endpoints/worklogs/worklogs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/worklogs/worklogs')>()),
  useIssueTimeIssuesIssueIdWorklogsGet: () => mocks.time,
  useLogTimeIssuesIssueIdWorklogsPost: () => mocks.create,
  useUpdateWorklogWorklogsWorklogIdPatch: () => mocks.update,
  useDeleteWorklogWorklogsWorklogIdDelete: () => mocks.remove,
}))

function entry(id: number, user: typeof ME, minutes: number, note: string | null = null) {
  return {
    id,
    issue_id: 9,
    user,
    minutes,
    worked_on: localToday(),
    note,
    created_at: '2026-09-25T09:00:00',
    updated_at: '2026-09-25T09:00:00',
  }
}

function renderSection(readOnly = false) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TimeSection issueId={9} readOnly={readOnly} />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.time.data = {
    total_minutes: 210,
    by_person: [
      { user: MAYA, minutes: 120 },
      { user: ME, minutes: 90 },
    ],
    entries: [entry(1, ME, 90, 'debugging the webhook retry'), entry(2, MAYA, 120)],
  }
  for (const m of [mocks.create, mocks.update, mocks.remove]) m.mutateAsync.mockReset().mockResolvedValue({})
})

afterEach(cleanup)

describe('TimeSection', () => {
  it('shows the total, whose it was, and each entry', () => {
    renderSection()
    expect(screen.getByText('3h 30m logged')).toBeTruthy()
    const people = screen.getByRole('list', { name: 'Time by person' })
    expect(people.textContent).toContain('Maya Chen2h')
    expect(screen.getByText(/debugging the webhook retry/)).toBeTruthy()
  })

  it('logs time typed the way people type it, on today by default', async () => {
    const user = renderSection()
    await user.click(screen.getByRole('button', { name: /Log time/ }))
    await user.type(screen.getByPlaceholderText('2h 30m'), '1h 15m')
    await user.type(screen.getByPlaceholderText('Debugging the webhook retry'), 'retry backoff')
    await user.click(screen.getByRole('button', { name: 'Log' }))
    expect(mocks.create.mutateAsync).toHaveBeenCalledWith({
      issueId: 9,
      data: { minutes: 75, worked_on: localToday(), note: 'retry backoff' },
    })
  })

  it('refuses a duration it cannot read, and says what would work', async () => {
    const user = renderSection()
    await user.click(screen.getByRole('button', { name: /Log time/ }))
    await user.type(screen.getByPlaceholderText('2h 30m'), 'a while')
    expect(screen.getByRole('alert').textContent).toMatch(/2h 30m, 45m or 1.5h/)
    await user.click(screen.getByRole('button', { name: 'Log' }))
    expect(mocks.create.mutateAsync).not.toHaveBeenCalled()
  })

  it('lets you change and delete your own entries only', async () => {
    const user = renderSection()
    expect(screen.getAllByRole('button', { name: /^Edit / })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /^Delete / })).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: /^Delete 1h 30m/ }))
    expect(mocks.remove.mutateAsync).toHaveBeenCalledWith({ worklogId: 1 })

    await user.click(screen.getByRole('button', { name: /^Edit 1h 30m/ }))
    const field = screen.getByDisplayValue('1h 30m')
    await user.clear(field)
    await user.type(field, '2h')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
      worklogId: 1,
      data: { minutes: 120, worked_on: localToday(), note: 'debugging the webhook retry' },
    })
  })

  it('shows a guest the time and nothing to log it with (#104)', () => {
    renderSection(true)
    expect(screen.getByText('3h 30m logged')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Log time/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull()
  })

  it('leaves the section out for a guest when nothing is logged', () => {
    mocks.time.data = { total_minutes: 0, by_person: [], entries: [] }
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <TimeSection issueId={9} readOnly />
      </QueryClientProvider>,
    )
    expect(container.textContent).toBe('')
  })
})

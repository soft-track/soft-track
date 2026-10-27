// @vitest-environment jsdom
/**
 * A test run (#275): its tally and each case with its result, recording a
 * result, raising a bug from a failure through the run -- the new-ticket
 * form filled in from the case -- and a closed run, whose results are fixed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ReleaseRead,
  StatusRead,
  TeamMemberRead,
  TestRunCaseRead,
  TestRunDetail,
  TestRunState,
  UserPublic,
} from '@/api/generated/models'
import { TeamProvider, type TeamContextValue } from '@/team/TeamContext'
import { RunPage } from '@/testcases/RunPage'
import { bugSectionsFrom } from '@/tickets/bugSections'

const mocks = vi.hoisted(() => ({
  detail: null as unknown,
  update: vi.fn(),
  raise: vi.fn(),
  close: vi.fn(),
  createTicket: vi.fn(),
}))

vi.mock('@/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 10 } }) }))
vi.mock('@/api/generated/endpoints/test-runs/test-runs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/test-runs/test-runs')>()),
  useGetRunTestRunsRunIdGet: () => ({ data: mocks.detail, isLoading: false, isError: false }),
  useCloseRunTestRunsRunIdClosePost: () => ({ mutateAsync: mocks.close, isPending: false }),
  useDeleteRunTestRunsRunIdDelete: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRaiseBugTestRunCasesRunCaseIdBugPost: () => ({ mutateAsync: mocks.raise, isPending: false }),
  useUpdateRunCaseTestRunCasesRunCaseIdPatch: () => ({ mutateAsync: mocks.update, isPending: false }),
  useDeleteFileTestResultFilesResultFileIdDelete: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
// What the new-ticket form asks for besides the run, as the new-bug test stubs it.
vi.mock('@/api/generated/endpoints/tickets/tickets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/tickets/tickets')>()),
  useCreateTicketTeamsTeamIdTicketsPost: () => ({ mutateAsync: mocks.createTicket, isPending: false }),
}))
vi.mock('@/api/generated/endpoints/search/search', () => ({
  useSearchSearchGet: () => ({ data: undefined, isLoading: false, isError: false }),
}))
vi.mock('@/api/generated/endpoints/templates/templates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/templates/templates')>()),
  useListTemplatesTeamsTeamIdTicketTemplatesGet: () => ({ data: [] }),
}))
vi.mock('@/api/generated/endpoints/custom-fields/custom-fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/custom-fields/custom-fields')>()),
  useListCustomFieldsTeamsTeamIdCustomFieldsGet: () => ({ data: [] }),
}))
vi.mock('@/markdown/lazy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/markdown/lazy')>()),
  MarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="Description" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

const RAVI: UserPublic = {
  id: 10,
  email: 'ravi@x.dev',
  username: 'ravi',
  full_name: 'Ravi Patel',
  avatar_color: '#123',
  is_active: true,
}

const TODO: StatusRead = {
  id: 1,
  team_id: 7,
  name: 'Todo',
  category: 'unstarted',
  position: 1,
  color: '#888',
}

const COMING: ReleaseRead = {
  id: 4,
  team_id: 7,
  name: '1.4.0',
  state: 'planned',
  created_at: '2026-01-01T00:00:00Z',
  progress: {
    tickets_total: 0,
    tickets_done: 0,
    points_total: 0,
    points_done: 0,
    tickets_unestimated: 0,
  },
}

const PDF_STEPS = [
  { action: 'Open Invoices.', expected: 'The list, newest first.' },
  { action: 'Open the first invoice.', expected: 'Its page, with a total.' },
  { action: 'Choose Download PDF.', expected: 'A PDF that matches the page.' },
]

function runCase(id: number, number: number, title: string, fields: Partial<TestRunCaseRead> = {}) {
  return {
    id,
    run_id: 3,
    case_id: number,
    identifier: `TC-${number}`,
    version: 1,
    title,
    steps: [],
    covers: [],
    files: [],
    ...fields,
  } satisfies TestRunCaseRead
}

const OPENS = runCase(31, 21, 'An invoice opens from the list', { result: 'passed', ran_by: RAVI })
const DOWNLOADS = runCase(32, 22, 'An invoice downloads as a PDF', {
  steps: PDF_STEPS,
  covers: ['ENG-10'],
  result: 'failed',
  failed_step: 3,
  note: 'A PDF with one blank page',
  ran_by: RAVI,
})
const PAID = runCase(33, 23, 'A paid invoice says so', {
  steps: [
    { action: 'Open a paid invoice.', expected: 'Its page.' },
    { action: 'Look at the status.', expected: 'It says Paid.' },
  ],
  assignee: RAVI,
})

function detail(
  state: TestRunState = 'open',
  cases: TestRunCaseRead[] = [OPENS, DOWNLOADS, PAID],
): TestRunDetail {
  return {
    run: {
      id: 3,
      team_id: 7,
      name: 'Regression for 1.4.0',
      release_id: COMING.id,
      environment: 'Staging',
      owner: RAVI,
      state,
      progress: { total: 3, passed: 1, failed: 1, blocked: 0, skipped: 0, not_run: 1, bugs: 0 },
      created_at: '2026-10-01T00:00:00Z',
      closed_at: state === 'closed' ? '2026-10-05T10:00:00Z' : null,
    },
    cases,
  }
}

function renderRun(role: TeamMemberRead['role'] = 'member') {
  const team: TeamContextValue = {
    team: {
      id: 7,
      name: 'Engineering',
      key: 'ENG',
      created_at: '2026-01-01T00:00:00Z',
      environments: ['Production', 'Staging', 'Development'],
    },
    teams: [],
    projects: [],
    labels: [],
    members: [{ role, joined_at: '2026-01-01T00:00:00Z', user: RAVI }],
    sprints: [],
    statuses: [TODO],
    releases: [COMING],
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamProvider value={team}>
        <MemoryRouter>
          <RunPage runId={3} onDeleted={() => {}} />
        </MemoryRouter>
      </TeamProvider>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const run = () => screen.getByRole('region', { name: 'Regression for 1.4.0' })

beforeEach(() => {
  mocks.detail = detail()
  mocks.update.mockReset().mockResolvedValue({})
  mocks.raise.mockReset().mockResolvedValue({})
  mocks.close.mockReset().mockResolvedValue({})
  mocks.createTicket.mockReset().mockResolvedValue({})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('a run', () => {
  it('says what it is for and tallies its results', () => {
    renderRun()
    expect(
      within(run()).getByText('For release 1.4.0 · Staging · owned by Ravi Patel · 3 cases'),
    ).toBeTruthy()
    const tally = within(run()).getByLabelText('How the run is going')
    // No skipped box while nothing was skipped.
    expect([...tally.children].map((box) => box.textContent)).toEqual([
      '1passed',
      '1failed',
      '0blocked',
      '1not run yet',
      '0bugs raised',
    ])
  })

  it('lists each case with its result, and where a failure failed', () => {
    renderRun()
    const results = within(run())
      .getAllByRole('button', { name: /^Result of / })
      .map((button) => button.getAttribute('aria-label'))
    expect(results).toEqual([
      'Result of TC-21: Passed. Change it',
      'Result of TC-22: Failed. Change it',
      'Result of TC-23: Not run. Change it',
    ])
    expect(within(run()).getByText('Step 3: A PDF with one blank page')).toBeTruthy()
  })

  it('records a result: failed at a step, with a note', async () => {
    const user = renderRun()
    await user.click(screen.getByRole('button', { name: 'Result of TC-23: Not run. Change it' }))
    const dialog = screen.getByRole('dialog', { name: 'TC-23 in Regression for 1.4.0' })
    await user.click(within(dialog).getByRole('radio', { name: 'Failed' }))
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /The step that failed/ }),
      '2',
    )
    await user.type(within(dialog).getByRole('textbox', { name: 'Note' }), 'It says Unpaid')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(mocks.update).toHaveBeenCalledWith({
      runCaseId: PAID.id,
      data: { result: 'failed', failed_step: 2, note: 'It says Unpaid', assignee_id: RAVI.id },
    })
  })

  it('raises a bug from a failure through the run, filled in from the case', async () => {
    const user = renderRun()
    await user.click(within(run()).getByRole('button', { name: 'Raise a bug' }))

    const form = screen.getByRole('dialog', { name: 'New ticket' })
    // On the body, not inside the run's glass panel, which would clip it.
    expect(run().contains(form)).toBe(false)
    expect((screen.getByRole('textbox', { name: 'Ticket title' }) as HTMLInputElement).value).toBe(
      'An invoice downloads as a PDF',
    )
    expect((screen.getByRole('combobox', { name: 'Type' }) as HTMLSelectElement).value).toBe('bug')
    const description = (screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement)
      .value
    expect(description).toBe(bugSectionsFrom(PDF_STEPS, 3, 'A PDF with one blank page'))
    expect(description).toContain('3. Choose Download PDF.')
    expect((screen.getByRole('combobox', { name: 'Environment' }) as HTMLSelectElement).value).toBe(
      'Staging',
    )
    expect((screen.getByRole('combobox', { name: 'Found in' }) as HTMLSelectElement).value).toBe(
      String(COMING.id),
    )
    expect(screen.getByText('Linked to TC-22 and ENG-10')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Create ticket' }))
    expect(mocks.raise).toHaveBeenCalledWith({
      runCaseId: DOWNLOADS.id,
      data: expect.objectContaining({
        title: 'An invoice downloads as a PDF',
        type: 'bug',
        environment: 'Staging',
        found_in_id: COMING.id,
      }),
    })
    expect(mocks.createTicket).not.toHaveBeenCalled()
  })

  it('links a failure to the bug it raised instead of offering another', () => {
    mocks.detail = detail('open', [
      {
        ...DOWNLOADS,
        bug: { id: 90, identifier: 'ENG-90', title: 'Invoice PDF renders blank', status: TODO },
      },
    ])
    renderRun()
    expect(within(run()).getByRole('button', { name: 'ENG-90' })).toBeTruthy()
    expect(within(run()).queryByRole('button', { name: 'Raise a bug' })).toBeNull()
  })
})

describe('a closed run', () => {
  it('keeps its results as they are', () => {
    mocks.detail = detail('closed')
    renderRun()
    expect(within(run()).getByText('Closed 5 Oct 2026. Its results are fixed.')).toBeTruthy()
    expect(within(run()).queryByRole('button', { name: 'Close run' })).toBeNull()
    expect(within(run()).queryByRole('button', { name: /^Result of / })).toBeNull()
    expect(within(run()).queryByRole('button', { name: 'Raise a bug' })).toBeNull()
    expect(within(run()).getByText('Failed')).toBeTruthy()
  })
})

describe('a guest', () => {
  it('reads an open run and changes nothing in it', () => {
    renderRun('guest')
    expect(within(run()).queryByRole('button', { name: 'Close run' })).toBeNull()
    expect(within(run()).queryByRole('button', { name: /^Result of / })).toBeNull()
    expect(within(run()).queryByRole('button', { name: 'Raise a bug' })).toBeNull()
  })
})

// @vitest-environment jsdom
/**
 * Test cases (#274): the Tests tab's folders and cases, a case with its
 * numbered steps and what it covers, writing one, and a story listing the
 * cases that cover it -- or saying none does, to a team that keeps cases.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  TeamMemberRead,
  TestCaseRead,
  TestFolderRead,
  TicketRead,
} from '@/api/generated/models'
import { TeamProvider, type TeamContextValue } from '@/team/TeamContext'
import { TestsView } from '@/testcases/TestsView'
import { TicketTestCases } from '@/testcases/TicketTestCases'

const mocks = vi.hoisted(() => ({
  folders: [] as unknown[],
  cases: [] as unknown[],
  asked: [] as unknown[],
  ticketCases: { uses_test_cases: true, cases: [] as unknown[] },
  create: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 10 } }) }))
vi.mock('@/markdown/lazy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/markdown/lazy')>()),
  Markdown: ({ children }: { children: string }) => <p>{children}</p>,
  MarkdownEditor: ({
    value,
    onChange,
  }: {
    value: string
    onChange: (value: string) => void
  }) => <textarea aria-label="Preconditions" value={value} onChange={(e) => onChange(e.target.value)} />,
}))
vi.mock('@/api/generated/endpoints/test-cases/test-cases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/test-cases/test-cases')>()),
  useListFoldersTeamsTeamIdTestFoldersGet: () => ({ data: mocks.folders, isLoading: false }),
  useListCasesTeamsTeamIdTestCasesGet: (_team: number, params: unknown) => {
    mocks.asked.push(params)
    return { data: mocks.cases, isLoading: false }
  },
  useTicketCasesTicketsTicketIdTestCasesGet: () => ({ data: mocks.ticketCases }),
  useCreateCaseTeamsTeamIdTestCasesPost: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateCaseTestCasesCaseIdPatch: () => ({ mutateAsync: mocks.update, isPending: false }),
  useListVersionsTestCasesCaseIdVersionsGet: () => ({ data: [] }),
}))

const AMINA: TeamMemberRead = {
  role: 'admin',
  joined_at: '2026-01-01T00:00:00Z',
  user: {
    id: 10,
    email: 'ravi@x.dev',
    username: 'ravi',
    full_name: 'Ravi Patel',
    avatar_color: '#123',
    is_active: true,
  },
}

const INVOICES: TestFolderRead = { id: 2, team_id: 7, name: 'Invoices', case_count: 2 }
const SIGN_IN: TestFolderRead = { id: 1, team_id: 7, name: 'Sign-in', case_count: 6 }

function testCase(id: number, title: string, fields: Partial<TestCaseRead> = {}): TestCaseRead {
  return {
    id,
    team_id: 7,
    number: id,
    identifier: `TC-${id}`,
    title,
    steps: [],
    state: 'ready',
    version: 1,
    labels: [],
    covers: [],
    folder_id: INVOICES.id,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...fields,
  }
}

const PDF = testCase(22, 'An invoice downloads as a PDF', {
  preconditions: 'Signed in as a customer with at least one invoice.',
  steps: [
    { action: 'Open Invoices.', expected: 'The list, newest first.' },
    { action: 'Open the first invoice.', expected: 'Its page, with a total.' },
    { action: 'Choose Download PDF.', expected: 'A PDF that matches the page.' },
  ],
  owner: AMINA.user,
  covers: [
    {
      id: 10,
      identifier: 'ENG-10',
      title: 'Portal: invoice list page',
      type: 'story',
      status: { id: 1, team_id: 7, name: 'Done', category: 'done', position: 1, color: '#0a0' },
    },
  ],
})

function wrap(children: ReactNode, role: TeamMemberRead['role'] = 'admin') {
  const team: TeamContextValue = {
    team: { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' },
    teams: [],
    projects: [],
    labels: [],
    members: [{ ...AMINA, role }],
    sprints: [],
    statuses: [],
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamProvider value={team}>
        <MemoryRouter>{children}</MemoryRouter>
      </TeamProvider>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.folders = [SIGN_IN, INVOICES]
  mocks.cases = [testCase(21, 'An invoice opens from the list'), PDF]
  mocks.asked = []
  mocks.ticketCases = { uses_test_cases: true, cases: [] }
  mocks.create.mockReset().mockResolvedValue(testCase(30, 'New'))
  mocks.update.mockReset().mockResolvedValue(PDF)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the Tests tab', () => {
  it('lists the folders with their counts, and the cases of the one open', async () => {
    const user = wrap(<TestsView />)
    const folders = screen.getByRole('navigation', { name: 'Folders of test cases' })
    expect(within(folders).getByRole('button', { name: /^Invoices/ }).textContent).toContain('2')

    await user.click(within(folders).getByRole('button', { name: /^Invoices/ }))
    expect(mocks.asked).toContainEqual(expect.objectContaining({ folder_id: INVOICES.id }))

    const list = screen.getByRole('region', { name: 'Test cases' })
    expect(within(list).getAllByRole('button', { name: /TC-/ }).map((b) => b.textContent)).toEqual([
      'TC-21An invoice opens from the listReady',
      'TC-22An invoice downloads as a PDFENG-10Ready',
    ])
  })

  it('opens a case with its preconditions, numbered steps and what it covers', async () => {
    const user = wrap(<TestsView />)
    await user.click(screen.getByRole('button', { name: /TC-22/ }))
    const open = screen.getByRole('article', { name: 'TC-22: An invoice downloads as a PDF' })
    expect(within(open).getByText('Signed in as a customer with at least one invoice.')).toBeTruthy()
    const rows = within(open).getAllByRole('row').slice(1)
    expect(rows.map((row) => row.textContent)).toEqual([
      '1Open Invoices.The list, newest first.',
      '2Open the first invoice.Its page, with a total.',
      '3Choose Download PDF.A PDF that matches the page.',
    ])
    expect(within(open).getByText('Portal: invoice list page')).toBeTruthy()
    expect(within(open).getByText('Ravi Patel')).toBeTruthy()
  })

  it('writes a case down with its steps, in the folder open', async () => {
    const user = wrap(<TestsView />)
    await user.click(screen.getByRole('button', { name: /^Invoices/ }))
    await user.click(screen.getByRole('button', { name: 'New test case' }))
    const dialog = screen.getByRole('dialog', { name: 'New test case' })
    await user.type(within(dialog).getByLabelText('Title'), 'A zip holds every invoice chosen')
    await user.type(within(dialog).getByLabelText('Step 1'), 'Choose two invoices.')
    await user.type(within(dialog).getByLabelText('What should happen at step 1'), 'Both ticked.')
    await user.click(within(dialog).getByRole('button', { name: 'Add a step' }))
    await user.type(within(dialog).getByLabelText('Step 2'), 'Download them.')
    await user.click(within(dialog).getByRole('button', { name: 'Create test case' }))

    expect(mocks.create).toHaveBeenCalledWith({
      teamId: 7,
      data: {
        title: 'A zip holds every invoice chosen',
        preconditions: null,
        steps: [
          { action: 'Choose two invoices.', expected: 'Both ticked.' },
          { action: 'Download them.', expected: '' },
        ],
        folder_id: INVOICES.id,
        owner_id: null,
        state: 'draft',
        label_ids: [],
        ticket_ids: [],
      },
    })
  })

  it('says what a test case is to a team with none, and offers a guest nothing', () => {
    mocks.folders = []
    mocks.cases = []
    wrap(<TestsView />, 'guest')
    expect(screen.getByText('No test cases yet')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New test case' })).toBeNull()
  })
})

describe('on a story', () => {
  const story = { id: 10, type: 'story' } as TicketRead

  it('lists the cases that cover it', () => {
    mocks.ticketCases = {
      uses_test_cases: true,
      cases: [{ id: 22, identifier: 'TC-22', title: 'An invoice downloads as a PDF', state: 'ready' }],
    }
    wrap(<TicketTestCases ticket={story} readOnly={false} />)
    expect(screen.getByRole('button', { name: 'Open TC-22' })).toBeTruthy()
  })

  it('says none covers it, and offers to write one covering it', async () => {
    const user = wrap(<TicketTestCases ticket={story} readOnly={false} />)
    expect(screen.getByText('No test case covers this story yet.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Write one' }))
    const dialog = screen.getByRole('dialog', { name: 'New test case' })
    await user.type(within(dialog).getByLabelText('Title'), 'Covers the story')
    await user.click(within(dialog).getByRole('button', { name: 'Create test case' }))
    expect(mocks.create.mock.calls[0][0].data.ticket_ids).toEqual([10])
  })

  it('says nothing to a team that keeps no test cases, or on a task', () => {
    mocks.ticketCases = { uses_test_cases: false, cases: [] }
    wrap(<TicketTestCases ticket={story} readOnly={false} />)
    expect(screen.queryByText('Test cases')).toBeNull()
    cleanup()
    mocks.ticketCases = { uses_test_cases: true, cases: [] }
    wrap(<TicketTestCases ticket={{ ...story, type: 'task' }} readOnly={false} />)
    expect(screen.queryByText('Test cases')).toBeNull()
  })
})

// @vitest-environment jsdom
/**
 * A new bug (#273): choosing Bug asks how bad, where and found in which
 * release, and offers the three sections of a bug's description -- steps to
 * reproduce, expected, actual -- as headings in its markdown.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReleaseRead, StatusRead } from '@/api/generated/models'
import { TeamProvider } from '@/team/TeamContext'
import type { TeamContextValue } from '@/team/useTeamContext'
import { bugSections, descriptionForType } from '@/tickets/bugSections'
import { NewTicketModal } from '@/tickets/NewTicketModal'

const mocks = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('@/api/generated/endpoints/tickets/tickets', () => ({
  useCreateTicketTeamsTeamIdTicketsPost: () => ({ mutateAsync: mocks.create, isPending: false }),
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

const TODO: StatusRead = {
  id: 1,
  team_id: 7,
  name: 'Todo',
  category: 'unstarted',
  position: 1,
  color: '#888',
}

function release(id: number, name: string, state: ReleaseRead['state'] = 'released'): ReleaseRead {
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

function renderForm(releases: ReleaseRead[] = [release(3, '1.3.2'), release(1, '0.9', 'archived')]) {
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
    members: [],
    sprints: [],
    statuses: [TODO],
    releases,
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamProvider value={team}>
        <NewTicketModal onClose={() => {}} />
      </TeamProvider>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const description = () => screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement

beforeEach(() => {
  mocks.create.mockReset().mockResolvedValue({})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the new-bug form', () => {
  it('asks a bug how bad, where and found in which release, and nothing else', async () => {
    const user = renderForm()
    expect(screen.queryByRole('combobox', { name: 'Severity' })).toBeNull()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'bug')
    const options = (name: string) =>
      [...(screen.getByRole('combobox', { name }) as HTMLSelectElement).options].map(
        (option) => option.text,
      )
    expect(options('Severity')).toEqual(['No severity', 'Critical', 'Major', 'Minor', 'Trivial'])
    expect(options('Environment')).toEqual(['No environment', 'Production', 'Staging', 'Development'])
    // A version that shipped can be where it was found; one put away is not offered.
    expect(options('Found in')).toEqual(['Found in no release', '1.3.2'])
  })

  it('offers the sections of a bug’s description, and takes them back if unused', async () => {
    const user = renderForm()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'bug')
    expect(description().value).toBe(bugSections())
    expect(description().value).toContain('## Steps to reproduce')
    expect(description().value).toContain('## Expected')
    expect(description().value).toContain('## Actual')

    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'task')
    expect(description().value).toBe('')
  })

  it('leaves alone a description somebody wrote', async () => {
    const user = renderForm()
    await user.type(description(), 'Seen on the invoice page.')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'bug')
    expect(description().value).toBe('Seen on the invoice page.')
  })

  it('sends a bug’s details with the bug', async () => {
    const user = renderForm()
    await user.type(screen.getByRole('textbox', { name: 'Ticket title' }), 'Invoice PDF renders blank')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'bug')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Severity' }), 'major')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Environment' }), 'Production')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Found in' }), '1.3.2')
    await user.click(screen.getByRole('button', { name: 'Create ticket' }))

    expect(mocks.create.mock.calls[0][0].data).toMatchObject({
      type: 'bug',
      severity: 'major',
      environment: 'Production',
      found_in_id: 3,
    })
  })

  it('does not ask a team with no releases where a bug was found', async () => {
    const user = renderForm([])
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'bug')
    expect(screen.queryByRole('combobox', { name: 'Found in' })).toBeNull()
  })
})

describe('descriptionForType', () => {
  it('fills an empty description for a bug, and keeps what was written', () => {
    expect(descriptionForType('', true)).toBe(bugSections())
    expect(descriptionForType('Mine', true)).toBe('Mine')
    expect(descriptionForType(bugSections(), false)).toBe('')
    expect(descriptionForType(`${bugSections()}Steps here`, false)).toBe(`${bugSections()}Steps here`)
  })
})

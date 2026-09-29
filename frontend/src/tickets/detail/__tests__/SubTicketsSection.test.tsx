// @vitest-environment jsdom
/**
 * Adding a sub-ticket from the panel on a team with required fields (#117):
 * the box asks for a title only, so what is required comes from the parent,
 * and what the parent cannot supply is refused by name.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CustomFieldRead, TicketRead } from '@/api/generated/models'
import { TeamProvider } from '@/team/TeamContext'
import type { TeamContextValue } from '@/team/useTeamContext'
import { SubTicketsSection } from '@/tickets/detail/SubTicketsSection'

const mocks = vi.hoisted(() => ({
  create: { mutateAsync: vi.fn() },
  fields: [] as unknown[],
}))

vi.mock('@/api/generated/endpoints/tickets/tickets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/tickets/tickets')>()),
  useCreateTicketTeamsTeamIdTicketsPost: () => mocks.create,
  useUpdateTicketTicketsTicketIdPatch: () => ({ mutateAsync: vi.fn() }),
  useListTicketsTeamsTeamIdTicketsGet: () => ({ data: { items: [] } }),
}))
vi.mock('@/api/generated/endpoints/custom-fields/custom-fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/custom-fields/custom-fields')>()),
  useListCustomFieldsTeamsTeamIdCustomFieldsGet: () => ({ data: mocks.fields }),
}))
vi.mock('@/tickets/surface', () => ({ useOpenRelatedTicket: () => vi.fn() }))

const TEAM: TeamContextValue = {
  team: { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' },
  teams: [],
  projects: [],
  labels: [],
  members: [],
  sprints: [],
  statuses: [],
}

function field(id: number, key: string, extra: Partial<CustomFieldRead> = {}): CustomFieldRead {
  return {
    id,
    team_id: 7,
    key,
    name: key,
    kind: 'user',
    options: [],
    required: true,
    applies_to: [],
    position: id,
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...extra,
  }
}

const PRIYA = {
  id: 10,
  email: 'priya@example.com',
  username: 'priya',
  full_name: 'Priya Raman',
  avatar_color: '#123',
  is_active: true,
}

const PARENT = {
  id: 42,
  team_id: 7,
  type: 'bug',
  parent: null,
  child_count: 0,
  completed_child_count: 0,
  custom_fields: { qa_assignee: PRIYA, environment: 'production', customer: 'Acme' },
} as unknown as TicketRead

function renderSection() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamProvider value={TEAM}>
        <SubTicketsSection ticket={PARENT} />
      </TeamProvider>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.create.mutateAsync.mockReset().mockResolvedValue(undefined)
  mocks.fields = []
})

afterEach(cleanup)

describe('SubTicketsSection', () => {
  it('files a sub-ticket with the parent’s value for a required field', async () => {
    mocks.fields = [
      field(1, 'qa_assignee'),
      // Required, but only on bugs: a new sub-ticket is a task.
      field(2, 'environment', { kind: 'select', applies_to: ['bug'] }),
      // The parent's, but not required: left for the sub-ticket to decide.
      field(3, 'customer', { kind: 'text', required: false }),
    ]
    const user = renderSection()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.type(screen.getByPlaceholderText('Sub-ticket title, then Enter'), 'Reproduce it{Enter}')
    expect(mocks.create.mutateAsync).toHaveBeenCalledWith({
      teamId: 7,
      data: { title: 'Reproduce it', parent_id: 42, custom_fields: { qa_assignee: 10 } },
    })
  })

  it('says which field is missing when the parent has no value either', async () => {
    mocks.create.mutateAsync.mockRejectedValue({
      response: {
        data: {
          detail: 'Reviewer is required on Engineering tickets.',
          code: 'custom_field_required',
        },
      },
    })
    mocks.fields = [field(4, 'reviewer')]
    const user = renderSection()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.type(screen.getByPlaceholderText('Sub-ticket title, then Enter'), 'Reproduce it{Enter}')
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Reviewer is required on Engineering tickets.',
    )
    // The title stays, to try again once the field is sorted out.
    expect(screen.getByDisplayValue('Reproduce it')).toBeTruthy()
  })
})

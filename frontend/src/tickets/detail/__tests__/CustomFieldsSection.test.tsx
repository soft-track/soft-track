// @vitest-environment jsdom
/**
 * The team's own fields on a ticket (#117): editable where the ticket takes
 * them, read-only where it only holds them, each change one PATCH.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  CustomFieldRead,
  TeamMemberRead,
  TicketRead,
  TicketUpdate,
} from '@/api/generated/models'
import { TeamProvider } from '@/team/TeamContext'
import type { TeamContextValue } from '@/team/useTeamContext'
import { CustomFieldsSection } from '@/tickets/detail/CustomFieldsSection'

const customFields = vi.hoisted(() => ({ data: [] as unknown[] }))
vi.mock('@/api/generated/endpoints/custom-fields/custom-fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/custom-fields/custom-fields')>()),
  useListCustomFieldsTeamsTeamIdCustomFieldsGet: () => customFields,
}))

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

const PRIYA = member(10, 'Priya Raman')
const DANIEL = member(11, 'Daniel Okafor')

const TEAM: TeamContextValue = {
  team: { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' },
  teams: [],
  projects: [],
  labels: [],
  members: [PRIYA, DANIEL],
  sprints: [],
  statuses: [],
}

function field(id: number, name: string, key: string, extra: Partial<CustomFieldRead> = {}): CustomFieldRead {
  return {
    id,
    team_id: 7,
    key,
    name,
    kind: 'user',
    options: [],
    required: false,
    applies_to: [],
    position: id,
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...extra,
  }
}

const FIELDS = [
  field(1, 'QA assignee', 'qa_assignee', { required: true }),
  field(2, 'Reviewer', 'reviewer'),
  field(3, 'Environment', 'environment', {
    kind: 'select',
    options: [
      { id: 'production', name: 'production' },
      { id: 'staging', name: 'staging' },
    ],
    applies_to: ['bug'],
  }),
  field(4, 'Sentry URL', 'sentry_url', { kind: 'url', applies_to: ['bug'] }),
  field(5, 'Customer', 'customer', { kind: 'text' }),
  field(6, 'Target release', 'target_release', { kind: 'date', applies_to: ['story'] }),
  field(7, 'Root cause', 'root_cause', {
    kind: 'select',
    options: [{ id: 'regression', name: 'Regression' }],
    archived_at: '2026-08-02T10:00:00Z',
  }),
]

const TICKET = {
  id: 42,
  team_id: 7,
  type: 'bug',
  custom_fields: {
    qa_assignee: PRIYA.user,
    environment: 'production',
    sentry_url: 'https://sentry.io/organizations/acme/issues/48213',
    customer: 'Acme Logistics',
    root_cause: 'regression',
  },
} as unknown as TicketRead

type Patch = (data: TicketUpdate) => Promise<void>

function renderSection({
  ticket = TICKET,
  patch = vi.fn<Patch>().mockResolvedValue(undefined),
  readOnly = false,
}: { ticket?: TicketRead; patch?: ReturnType<typeof vi.fn<Patch>>; readOnly?: boolean } = {}) {
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamProvider value={TEAM}>
        <CustomFieldsSection ticket={ticket} patch={patch} readOnly={readOnly} />
      </TeamProvider>
    </QueryClientProvider>,
  )
  return { patch, user: userEvent.setup(), ...view }
}

beforeEach(() => {
  customFields.data = FIELDS
})

afterEach(cleanup)

describe('CustomFieldsSection', () => {
  it('shows the fields a ticket of its type has, in the team’s order', () => {
    renderSection()
    expect(screen.getByText('Engineering fields')).toBeTruthy()
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'QA assignee' }).value).toBe('10')
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Reviewer' }).value).toBe('')
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Environment' }).value).toBe(
      'production',
    )
    // A story field, with nothing in it: not on a bug at all.
    expect(screen.queryByText('Target release')).toBeNull()
  })

  it('keeps an archived field’s value readable, and nothing else', () => {
    renderSection()
    expect(screen.getByText('Root cause')).toBeTruthy()
    expect(screen.getByText('Regression').getAttribute('title')).toMatch(/Archived/)
    expect(screen.queryByRole('combobox', { name: 'Root cause' })).toBeNull()
  })

  it('saves a person as their id, one field at a time', async () => {
    const { patch, user } = renderSection()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Reviewer' }), 'Daniel Okafor')
    expect(patch).toHaveBeenCalledWith({ custom_fields: { reviewer: 11 } })
  })

  it('saves typed text when it is done, not on every key', async () => {
    const { patch, user } = renderSection()
    const customer = screen.getByRole('textbox', { name: 'Customer' })
    await user.clear(customer)
    await user.type(customer, 'Northwind')
    expect(patch).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    expect(patch).toHaveBeenCalledTimes(1)
    expect(patch).toHaveBeenCalledWith({ custom_fields: { customer: 'Northwind' } })
  })

  it('shows a link as one, and edits it on request', async () => {
    const { patch, user } = renderSection()
    const link = screen.getByRole('link', { name: /sentry\.io\/…\/48213/ })
    expect(link.getAttribute('href')).toBe('https://sentry.io/organizations/acme/issues/48213')
    await user.click(screen.getByRole('button', { name: 'Edit Sentry URL' }))
    const box = screen.getByRole('textbox', { name: 'Sentry URL' })
    await user.clear(box)
    await user.type(box, 'https://sentry.io/issues/1{Enter}')
    expect(patch).toHaveBeenCalledWith({ custom_fields: { sentry_url: 'https://sentry.io/issues/1' } })
  })

  it('says why, in the server’s words, when a value is refused', async () => {
    const patch = vi.fn<Patch>().mockRejectedValue({
      response: {
        data: {
          detail: 'QA assignee is required on Engineering tickets.',
          code: 'custom_field_required',
        },
      },
    })
    const { user } = renderSection({ patch })
    await user.selectOptions(screen.getByRole('combobox', { name: 'QA assignee' }), '')
    expect((await screen.findByRole('alert')).textContent).toBe(
      'QA assignee is required on Engineering tickets.',
    )
  })

  it('shows a guest every value and lets them change none', () => {
    renderSection({ readOnly: true })
    // Disabled by the fieldset around them, which is what `:disabled` reads.
    expect(screen.getByRole('combobox', { name: 'QA assignee' }).matches(':disabled')).toBe(true)
    expect(screen.getByRole('textbox', { name: 'Customer' }).matches(':disabled')).toBe(true)
  })

  it('is not there at all for a team with no fields', () => {
    customFields.data = []
    const { container } = renderSection()
    expect(container.textContent).toBe('')
  })
})

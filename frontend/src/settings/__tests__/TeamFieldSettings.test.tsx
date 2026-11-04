// @vitest-environment jsdom
/**
 * The team's own fields in settings (#117): admins add, set, archive and
 * delete them; members see what tickets on the team will carry, and how much
 * each field is used (#334).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CustomFieldRead, CustomFieldUsage } from '@/api/generated/models'
import TeamFieldSettings from '@/settings/TeamFieldSettings'

const ADA = { id: 10, email: 'ada@example.com', username: 'ada', full_name: 'Ada', avatar_color: '#123', is_active: true }
const TEAM = { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' }

const mocks = vi.hoisted(() => ({
  role: 'admin' as string,
  fields: [] as unknown[],
  usage: [] as unknown[],
  create: { mutateAsync: vi.fn() },
  update: { mutateAsync: vi.fn() },
  reorder: { mutateAsync: vi.fn() },
  remove: { mutateAsync: vi.fn() },
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: ADA }),
}))
vi.mock('@/team/useTeams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/team/useTeams')>()),
  useTeamByKey: () => ({ team: TEAM, isLoading: false, isError: false, teams: [TEAM] }),
}))
vi.mock('@/api/generated/endpoints/teams/teams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/teams/teams')>()),
  useListTeamMembersTeamsTeamIdMembersGet: () => ({
    data: [{ role: mocks.role, joined_at: '2026-01-01T00:00:00Z', user: ADA }],
  }),
}))
vi.mock('@/api/generated/endpoints/custom-fields/custom-fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/custom-fields/custom-fields')>()),
  useListCustomFieldsTeamsTeamIdCustomFieldsGet: () => ({ data: mocks.fields, isLoading: false }),
  useCustomFieldUsageTeamsTeamIdCustomFieldsUsageGet: () => ({ data: mocks.usage }),
  useCreateCustomFieldTeamsTeamIdCustomFieldsPost: () => mocks.create,
  useUpdateCustomFieldCustomFieldsFieldIdPatch: () => mocks.update,
  useReorderCustomFieldsTeamsTeamIdCustomFieldsOrderPut: () => mocks.reorder,
  useDeleteCustomFieldCustomFieldsFieldIdDelete: () => mocks.remove,
}))

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

const QA = field(1, 'QA assignee', 'qa_assignee', { required: true })
const ENVIRONMENT = field(2, 'Environment', 'environment', {
  kind: 'select',
  options: [
    { id: 'production', name: 'production' },
    { id: 'staging', name: 'staging' },
    { id: 'dev', name: 'dev' },
  ],
  applies_to: ['bug'],
})
const ROOT_CAUSE = field(3, 'Root cause', 'root_cause', {
  kind: 'text',
  archived_at: '2026-08-02T10:00:00Z',
})

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/settings/teams/ENG/fields']}>
        <Routes>
          <Route path="/settings/teams/:teamKey/fields" element={<TeamFieldSettings />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.role = 'admin'
  mocks.fields = []
  mocks.usage = []
  for (const m of [mocks.create, mocks.update, mocks.reorder, mocks.remove]) {
    m.mutateAsync.mockReset().mockResolvedValue(undefined)
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TeamFieldSettings', () => {
  it('lists the fields with their kind, key, required flag and types', () => {
    mocks.fields = [QA, ENVIRONMENT, ROOT_CAUSE]
    renderPage()
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).getByText('QA assignee')).toBeTruthy()
    expect(within(rows[0]).getByText('qa_assignee')).toBeTruthy()
    expect(within(rows[0]).getByText('User')).toBeTruthy()
    expect(
      within(rows[0]).getByRole<HTMLInputElement>('switch', { name: 'QA assignee is required' }).checked,
    ).toBe(true)
    expect(within(rows[0]).getByRole('button', { name: 'Ticket types QA assignee shows on' }).textContent).toBe(
      'All types',
    )
    expect(within(rows[1]).getByText('3 options')).toBeTruthy()
    expect(within(rows[1]).getByRole('button', { name: 'Ticket types Environment shows on' }).textContent).toBe(
      'Bug',
    )
    // Archived ones sit apart, their values still readable on tickets.
    expect(screen.getByText('Archived')).toBeTruthy()
    expect(within(rows[2]).getByText(/Archived 2 Aug · values still show on tickets/)).toBeTruthy()
  })

  it('lets an admin add a select field, with a key made from its name', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Add a field' }))
    await user.click(screen.getByRole('menuitem', { name: 'Select' }))
    await user.type(screen.getByPlaceholderText('Reviewer'), 'Target environment')
    expect(screen.getByDisplayValue('target_environment')).toBeTruthy()
    await user.type(screen.getByLabelText('Option 1'), 'production')
    await user.type(screen.getByLabelText('Option 2'), 'staging')
    await user.click(screen.getByRole('switch'))
    await user.click(screen.getByRole('button', { name: 'Shows on' }))
    await user.click(screen.getByRole('checkbox', { name: 'Bug' }))
    await user.click(screen.getByRole('button', { name: 'Add field' }))

    expect(mocks.create.mutateAsync).toHaveBeenCalledWith({
      teamId: 7,
      data: {
        kind: 'select',
        name: 'Target environment',
        key: 'target_environment',
        required: true,
        applies_to: ['bug'],
        options: [{ name: 'production' }, { name: 'staging' }],
      },
    })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add field' })).toBeNull())
  })

  it('steps a made-up key around one the team already has, and takes a typed one', async () => {
    mocks.fields = [QA]
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Add a field' }))
    await user.click(screen.getByRole('menuitem', { name: 'User' }))
    await user.type(screen.getByPlaceholderText('Reviewer'), 'QA assignee!')
    expect(screen.getByDisplayValue('qa_assignee_2')).toBeTruthy()

    const key = screen.getByDisplayValue('qa_assignee_2')
    await user.clear(key)
    await user.type(key, 'Bad-Key')
    expect(screen.getByText(/Lowercase letters, digits and underscores/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Add field' }))
    expect(mocks.create.mutateAsync).not.toHaveBeenCalled()
  })

  it('shows the server’s reason when it refuses', async () => {
    mocks.create.mutateAsync.mockRejectedValue({
      response: { data: { detail: 'This team already has a field with that name', code: 'custom_field_name_taken' } },
    })
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Add a field' }))
    await user.click(screen.getByRole('menuitem', { name: 'Text' }))
    await user.type(screen.getByPlaceholderText('Reviewer'), 'Reviewer')
    await user.click(screen.getByRole('button', { name: 'Add field' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/already has a field/)
    expect(screen.getByRole('button', { name: 'Add field' })).toBeTruthy()
  })

  it('makes a field required, binds it to types and archives it', async () => {
    mocks.fields = [ENVIRONMENT]
    const user = renderPage()
    await user.click(screen.getByRole('switch', { name: 'Environment is required' }))
    expect(mocks.update.mutateAsync).toHaveBeenLastCalledWith({ fieldId: 2, data: { required: true } })

    await user.click(screen.getByRole('button', { name: 'Ticket types Environment shows on' }))
    await user.click(screen.getByRole('checkbox', { name: 'Story' }))
    expect(mocks.update.mutateAsync).toHaveBeenLastCalledWith({
      fieldId: 2,
      data: { applies_to: ['bug', 'story'] },
    })

    await user.click(screen.getByRole('button', { name: 'Archive Environment' }))
    expect(mocks.update.mutateAsync).toHaveBeenLastCalledWith({ fieldId: 2, data: { archived: true } })
  })

  it('renames a field and edits its options, keeping the ids of the ones kept', async () => {
    mocks.fields = [ENVIRONMENT]
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Edit Environment' }))
    const name = screen.getByDisplayValue('Environment')
    await user.clear(name)
    await user.type(name, 'Env')
    await user.click(screen.getByRole('button', { name: 'Remove dev' }))
    await user.click(screen.getByRole('button', { name: 'Add an option' }))
    await user.type(screen.getByLabelText('Option 3'), 'qa')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
      fieldId: 2,
      data: {
        name: 'Env',
        options: [
          { id: 'production', name: 'production' },
          { id: 'staging', name: 'staging' },
          { name: 'qa' },
        ],
      },
    })
  })

  it('restores an archived field, and deletes one only once its name is typed', async () => {
    mocks.fields = [ROOT_CAUSE]
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Restore Root cause' }))
    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({ fieldId: 3, data: { archived: false } })

    await user.click(screen.getByRole('button', { name: 'Delete Root cause' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete “Root cause”' })
    const confirm = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Delete the field' })
    expect(confirm.disabled).toBe(true)
    await user.type(within(dialog).getByRole('textbox'), 'Root caus')
    expect(confirm.disabled).toBe(true)
    await user.type(within(dialog).getByRole('textbox'), 'e')
    await user.click(confirm)
    expect(mocks.remove.mutateAsync).toHaveBeenCalledWith({ fieldId: 3 })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('shows a member the fields without the controls to change them', () => {
    mocks.role = 'member'
    mocks.fields = [QA, ROOT_CAUSE]
    renderPage()
    expect(screen.getByText('QA assignee')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add a field' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Reorder/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Archive QA assignee' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete Root cause' })).toBeNull()
    expect(screen.getByRole<HTMLInputElement>('switch', { name: 'QA assignee is required' }).disabled).toBe(true)
    expect(screen.getByText('Only team admins can change the team’s fields.')).toBeTruthy()
  })

  it('says so when the team has none yet', () => {
    renderPage()
    expect(screen.getByText(/No fields yet/)).toBeTruthy()
  })
})

describe('how much each field is used (#334)', () => {
  const HOURS_AGO = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()

  const SEVERITY = field(4, 'Severity', 'severity', {
    kind: 'select',
    required: true,
    options: [
      { id: 'sev_1', name: 'sev-1' },
      { id: 'sev_2', name: 'sev-2' },
      { id: 'sev_3', name: 'sev-3' },
    ],
    applies_to: ['bug'],
  })
  const REVIEWER = field(5, 'Reviewer', 'reviewer')
  const ENVIRONMENT_WITH_QA = {
    ...ENVIRONMENT,
    options: [...ENVIRONMENT.options, { id: 'qa', name: 'qa' }],
  }
  const SENTRY = field(6, 'Sentry URL', 'sentry_url', { kind: 'url', applies_to: ['bug'] })
  const RELEASE_NOTES = field(7, 'Release notes written', 'release_notes_written', {
    kind: 'checkbox',
    applies_to: ['story'],
  })
  const PLATFORMS = field(8, 'Platforms', 'platforms', {
    kind: 'multi_select',
    options: [{ id: 'ios', name: 'iOS' }],
    applies_to: ['bug', 'story'],
  })

  const MEI = { ...ADA, id: 11, username: 'mei', full_name: 'Mei Tanaka' }
  const RAVI = { ...ADA, id: 12, username: 'ravi', full_name: 'Ravi Patel' }

  function used(row: Partial<CustomFieldUsage> & { field_id: number }): CustomFieldUsage {
    return { open_tickets: 24, with_value: 0, options: [], people: [], last_set_at: null, ...row }
  }

  const USAGE = [
    used({
      field_id: 4,
      with_value: 24,
      options: [
        { id: 'sev_1', count: 0 },
        { id: 'sev_2', count: 2 },
        { id: 'sev_3', count: 22 },
      ],
    }),
    used({
      field_id: 1,
      open_tickets: 23,
      with_value: 21,
      people: [
        { user: MEI, count: 12 },
        { user: RAVI, count: 9 },
      ],
      last_set_at: HOURS_AGO,
    }),
    used({ field_id: 5, open_tickets: 50, with_value: 19 }),
    used({
      field_id: 2,
      with_value: 16,
      options: [
        { id: 'production', count: 9 },
        { id: 'staging', count: 5 },
        { id: 'dev', count: 2 },
        { id: 'qa', count: 0 },
      ],
      last_set_at: HOURS_AGO,
    }),
    used({ field_id: 6, with_value: 3 }),
    used({ field_id: 7, with_value: 18, last_set_at: '2026-01-02T09:00:00' }),
    used({ field_id: 8, open_tickets: 0 }),
  ]

  function useLine(name: string) {
    return screen.getByRole('button', { name: new RegExp(`Show how ${name} is used$`) })
  }

  it('says under each field how many of its open tickets have a value', () => {
    mocks.fields = [SEVERITY, QA, REVIEWER, ENVIRONMENT, SENTRY, PLATFORMS]
    mocks.usage = USAGE
    renderPage()
    // Out of the types it shows on, and a select one option has taken over says so.
    expect(useLine('Severity').textContent).toBe('on every open bug · 22 of 24 say sev-3 · Show how Severity is used')
    expect(useLine('QA assignee').textContent).toMatch(/^on 91% of open tickets ·/)
    expect(useLine('Reviewer').textContent).toMatch(/^on 38% of open tickets ·/)
    expect(useLine('Environment').textContent).toMatch(/^on 67% of open bugs ·/)
    // A handful is counted rather than made a rate.
    expect(useLine('Sentry URL').textContent).toMatch(/^on 3 of 24 open bugs ·/)
    expect(useLine('Platforms').textContent).toMatch(/^no open bugs and stories to count ·/)
    // Counts, and no tickets named: nothing on the page links anywhere.
    expect(screen.queryAllByRole('link')).toEqual([])
  })

  it('is on the fields in use and not on an archived one', () => {
    mocks.fields = [QA, ROOT_CAUSE]
    mocks.usage = [...USAGE, used({ field_id: 3, with_value: 4 })]
    renderPage()
    expect(useLine('QA assignee')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Show how Root cause is used/ })).toBeNull()
  })

  it('opens a select into a count per option, the unused one included', async () => {
    mocks.fields = [ENVIRONMENT_WITH_QA]
    mocks.usage = USAGE
    const user = renderPage()
    const line = useLine('Environment')
    expect(line.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('list', { name: 'How Environment is used' })).toBeNull()

    await user.click(line)
    expect(line.getAttribute('aria-expanded')).toBe('true')
    expect(line.textContent).toMatch(/Hide how Environment is used$/)
    const breakdown = screen.getByRole('list', { name: 'How Environment is used' })
    expect(line.getAttribute('aria-controls')).toBe(breakdown.parentElement!.id)
    expect(within(breakdown).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'production9',
      'staging5',
      'dev2',
      'qanobody',
      'None8',
    ])
    expect(screen.getByText('Of 24 open bugs · last set on a ticket about 2 hours ago')).toBeTruthy()

    await user.click(line)
    expect(line.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('list', { name: 'How Environment is used' })).toBeNull()
  })

  it('opens a user field into a count per person, nobody a row of its own', async () => {
    mocks.fields = [QA]
    mocks.usage = USAGE
    const user = renderPage()
    await user.click(useLine('QA assignee'))
    const breakdown = screen.getByRole('list', { name: 'How QA assignee is used' })
    expect(within(breakdown).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'Mei Tanaka12',
      'Ravi Patel9',
      'Nobody2',
    ])
  })

  it('opens a checkbox into ticked against not ticked', async () => {
    mocks.fields = [RELEASE_NOTES]
    mocks.usage = USAGE
    const user = renderPage()
    expect(useLine('Release notes written').textContent).toMatch(/^on 75% of open stories ·/)
    await user.click(useLine('Release notes written'))
    const bar = screen.getByRole('img', { name: '18 ticked, 6 not ticked' })
    expect(bar.textContent).toBe('Ticked · 186')
    expect(screen.getByText(/^Of 24 open stories\. Last ticked .+ ago\.$/)).toBeTruthy()
  })

  it('says when a field was never set, and nothing to break down for a link', async () => {
    mocks.fields = [SENTRY]
    mocks.usage = USAGE
    const user = renderPage()
    await user.click(useLine('Sentry URL'))
    expect(screen.queryByRole('list', { name: 'How Sentry URL is used' })).toBeNull()
    expect(screen.getByText('Of 24 open bugs · never set on a ticket')).toBeTruthy()
  })
})

// @vitest-environment jsdom
/**
 * The team's own fields in settings (#117): admins add, set, archive and
 * delete them; members see what tickets on the team will carry.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CustomFieldRead } from '@/api/generated/models'
import TeamFieldSettings from '@/settings/TeamFieldSettings'

const ADA = { id: 10, email: 'ada@example.com', username: 'ada', full_name: 'Ada', avatar_color: '#123', is_active: true }
const TEAM = { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' }

const mocks = vi.hoisted(() => ({
  role: 'admin' as string,
  fields: [] as unknown[],
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

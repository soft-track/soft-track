// @vitest-environment jsdom
/**
 * Settings → a team → Labels (#321): rename in place, recolour from the
 * palette, add, and delete by merging into another label or taking it off
 * the tickets, with the saved views and rules that name it listed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TeamLabelSettings from '@/settings/TeamLabelSettings'

const AMINA = { id: 10, email: 'a@example.com', username: 'amina', full_name: 'Amina Khan', avatar_color: '#123', is_active: true }
const TEAM = { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' }

const label = (id: number, name: string, color: string) => ({ id, team_id: 7, name, color })
const BUG = label(1, 'Bug', '#ef4444')
const FEATURE = label(2, 'Feature', '#22c55e')
const RELEASE = label(3, 'Release 1.2', '#94a3b8')

const mocks = vi.hoisted(() => ({
  role: 'admin' as string,
  labels: [] as unknown[],
  usage: [] as unknown[],
  create: { mutateAsync: vi.fn() },
  update: { mutateAsync: vi.fn() },
  remove: { mutateAsync: vi.fn() },
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: AMINA }),
}))
vi.mock('@/team/useTeams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/team/useTeams')>()),
  useTeamByKey: () => ({ team: TEAM, isLoading: false, isError: false, teams: [TEAM] }),
}))
vi.mock('@/api/generated/endpoints/teams/teams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/teams/teams')>()),
  useListTeamMembersTeamsTeamIdMembersGet: () => ({
    data: [{ role: mocks.role, joined_at: '2026-01-01T00:00:00Z', user: AMINA }],
  }),
}))
vi.mock('@/api/generated/endpoints/labels/labels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/labels/labels')>()),
  useListLabelsTeamsTeamIdLabelsGet: () => ({ data: mocks.labels, isLoading: false }),
  useLabelUsageTeamsTeamIdLabelsUsageGet: () => ({ data: mocks.usage }),
  useCreateLabelTeamsTeamIdLabelsPost: () => mocks.create,
  useUpdateLabelLabelsLabelIdPatch: () => mocks.update,
  useDeleteLabelLabelsLabelIdDelete: () => mocks.remove,
}))

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/settings/teams/ENG/labels']}>
        <Routes>
          <Route path="/settings/teams/:teamKey/labels" element={<TeamLabelSettings />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const rowOf = (name: string) =>
  screen.getByRole('textbox', { name: `Name of ${name}` }).closest('li') as HTMLElement

beforeEach(() => {
  mocks.role = 'admin'
  mocks.labels = [BUG, FEATURE, RELEASE]
  mocks.usage = [
    { label_id: 1, ticket_count: 18, views: [], hidden_view_count: 0, rules: [] },
    { label_id: 2, ticket_count: 31, views: [], hidden_view_count: 0, rules: [] },
    {
      label_id: 3,
      ticket_count: 12,
      views: [{ id: 5, name: 'Release 1.2 leftovers' }],
      hidden_view_count: 1,
      rules: [{ id: 8, name: 'Tag release work' }],
    },
  ]
  for (const m of [mocks.create, mocks.update, mocks.remove]) {
    m.mutateAsync.mockReset().mockResolvedValue(undefined)
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TeamLabelSettings', () => {
  it('lists each label with its colour, chip and how many tickets carry it', () => {
    renderPage()
    const row = rowOf('Release 1.2')
    expect(within(row).getByText('12 tickets')).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Colour of Release 1.2: Slate' })).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Delete Release 1.2' })).toBeTruthy()
  })

  it('renames in place, on Enter', async () => {
    const user = renderPage()
    const name = screen.getByRole('textbox', { name: 'Name of Release 1.2' })
    await user.clear(name)
    await user.type(name, 'Release 1.2.1{Enter}')
    expect(mocks.update.mutateAsync).toHaveBeenCalledTimes(1)
    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
      labelId: 3,
      data: { name: 'Release 1.2.1' },
    })
  })

  it('keeps a refused name to correct, and says why under the row', async () => {
    mocks.update.mutateAsync.mockRejectedValue({
      response: {
        data: {
          code: 'label_name_taken',
          detail: '“feature” is taken by Feature. Label names are unique, whatever the case.',
        },
      },
    })
    const user = renderPage()
    const name = screen.getByRole('textbox', { name: 'Name of Bug' })
    await user.clear(name)
    await user.type(name, 'feature{Enter}')

    const alert = await within(rowOf('Bug')).findByRole('alert')
    expect(alert.textContent).toContain('“feature” is taken by Feature.')
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect((name as HTMLInputElement).value).toBe('feature')

    // Escape puts the name back and clears the complaint.
    await user.click(name)
    await user.keyboard('{Escape}')
    expect((name as HTMLInputElement).value).toBe('Bug')
    expect(within(rowOf('Bug')).queryByRole('alert')).toBeNull()
  })

  it('recolours from a palette of ten', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Colour of Bug: Red' }))
    const palette = screen.getByRole('radiogroup', { name: 'Colour' })
    const swatches = within(palette).getAllByRole('radio')
    expect(swatches).toHaveLength(10)
    expect(within(palette).getByRole('radio', { name: 'Red' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    await user.click(within(palette).getByRole('radio', { name: 'Sky' }))
    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
      labelId: 1,
      data: { color: '#0ea5e9' },
    })
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('adds a label', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Add a label' }))
    await user.type(screen.getByRole('textbox', { name: 'Name of the new label' }), 'Needs design')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(mocks.create.mutateAsync).toHaveBeenCalledWith({
      teamId: 7,
      data: { name: 'Needs design', color: '#ef4444' },
    })
  })

  it('merges a deleted label into another, saying what each view and rule will do', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Delete Release 1.2' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete “Release 1.2”?' })
    expect(dialog.textContent).toContain('12 tickets carry it. Choose what happens to them.')
    expect(within(dialog).getByRole<HTMLInputElement>('radio', { name: 'Merge into another label' }).checked).toBe(true)

    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'The label to merge it into' }),
      'Feature',
    )
    const named = within(dialog).getAllByRole('listitem').map((item) => item.textContent)
    expect(named).toEqual([
      'The saved view “Release 1.2 leftovers”, which will filter by Feature.',
      'One private view of somebody else’s, which will filter by Feature.',
      'The automation rule “Tag release work”, which will name Feature instead.',
    ])

    await user.click(within(dialog).getByRole('button', { name: 'Delete label' }))
    expect(mocks.remove.mutateAsync).toHaveBeenCalledWith({
      labelId: 3,
      params: { merge_into: 2 },
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('takes a deleted label off its tickets, and says the rule is switched off', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Delete Release 1.2' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: 'Remove it from the tickets' }))
    expect(within(dialog).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'The saved view “Release 1.2 leftovers”, which will stop filtering by a label.',
      'One private view of somebody else’s, which will stop filtering by a label.',
      'The automation rule “Tag release work”, which will be switched off.',
    ])
    await user.click(within(dialog).getByRole('button', { name: 'Delete label' }))
    expect(mocks.remove.mutateAsync).toHaveBeenCalledWith({ labelId: 3, params: undefined })
  })

  it('lets a member rename but not delete', () => {
    mocks.role = 'member'
    renderPage()
    expect(screen.getByRole('textbox', { name: 'Name of Bug' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Delete Bug' })).toBeNull()
    expect(screen.getByText(/Team admins delete them/)).toBeTruthy()
  })

  it('shows a guest the labels and nothing to change', () => {
    mocks.role = 'guest'
    renderPage()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Colour of|Delete|Add a label/ })).toBeNull()
    expect(screen.getByText('Release 1.2', { selector: 'span.flex-1' })).toBeTruthy()
  })
})

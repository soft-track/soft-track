// @vitest-environment jsdom
/**
 * Archive a team, and delete one that was a mistake (#322): the section
 * below what a team is called, and the dialog that says what stops before
 * anything happens. The words are the mockup's.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TeamGeneralSettings from '@/settings/TeamGeneralSettings'

const AMINA = {
  id: 10,
  email: 'a@x.dev',
  username: 'amina',
  full_name: 'Amina Khan',
  avatar_color: '#123',
  is_active: true,
}

const mocks = vi.hoisted(() => ({
  role: 'admin' as string,
  siteAdmin: false,
  archivedAt: null as string | null,
  preview: undefined as unknown,
  update: vi.fn(),
  remove: vi.fn(),
}))

const PREVIEW = {
  members: 8,
  automation_rules: 3,
  webhooks: 1,
  repository_links: 2,
  recurring_tickets: 1,
  open_tickets: 14,
  tickets: 214,
}

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: { ...AMINA, is_site_admin: mocks.siteAdmin } }),
}))
vi.mock('@/team/useTeams', async (importOriginal) => {
  const team = () => ({
    id: 7,
    name: 'Engineering',
    key: 'ENG',
    description: 'Core engineering team',
    created_at: '2026-01-01T00:00:00Z',
    any_member_may_delete: false,
    guests_may_comment: false,
    archived_at: mocks.archivedAt,
    archived: Boolean(mocks.archivedAt),
  })
  return {
    ...(await importOriginal<typeof import('@/team/useTeams')>()),
    useTeamByKey: () => ({ team: team(), isLoading: false, isError: false, teams: [team()] }),
  }
})
vi.mock('@/api/generated/endpoints/teams/teams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/teams/teams')>()),
  useListTeamMembersTeamsTeamIdMembersGet: () => ({
    data: [{ role: mocks.role, joined_at: '2026-01-01T00:00:00Z', user: AMINA }],
  }),
  useUpdateTeamTeamsTeamIdPatch: () => ({ mutateAsync: mocks.update, isPending: false }),
  useDeleteTeamTeamsTeamIdDelete: () => ({ mutateAsync: mocks.remove, isPending: false }),
  useArchivePreviewTeamsTeamIdArchivePreviewGet: () => ({
    data: mocks.preview,
    isError: false,
  }),
}))

function renderPage(queryClient = new QueryClient()) {
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/settings/teams/ENG/general']}>
        <Routes>
          <Route path="/settings/teams/:teamKey/general" element={<TeamGeneralSettings />} />
          <Route path="/:teamKey" element={<p>Board of the next team</p>} />
          <Route path="/" element={<p>No team</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const section = () => screen.getByRole('region', { name: 'Archive' })

beforeEach(() => {
  mocks.role = 'admin'
  mocks.siteAdmin = false
  mocks.archivedAt = null
  mocks.preview = PREVIEW
  mocks.update.mockReset().mockResolvedValue({})
  mocks.remove.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the archive section (frame 1)', () => {
  it('says what archiving does, and why the team is not deleted', () => {
    renderPage()
    const archive = within(section())
    expect(archive.getByText('Archive Engineering')).toBeTruthy()
    expect(section().textContent).toContain(
      'Read-only, and out of the team switcher, pickers and search. Tickets, comments and history stay, and ENG-42 keeps resolving.',
    )
    expect(archive.getByRole('button', { name: 'Archive team…' })).toBeTruthy()
    expect(archive.getByText('Delete Engineering')).toBeTruthy()
    expect(
      archive.getByText(
        'Only for a team with no tickets. Engineering has 214, so it is archived and not deleted.',
      ),
    ).toBeTruthy()
    expect(archive.getByRole<HTMLButtonElement>('button', { name: 'Delete team' }).disabled).toBe(
      true,
    )
  })

  it('sits below what the team is called', () => {
    renderPage()
    const general = screen.getByRole('heading', { name: 'General' })
    expect(
      general.compareDocumentPosition(section()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    // Before the team's other settings.
    const findable = screen.getByText('Who can find this team')
    expect(
      section().compareDocumentPosition(findable) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('is not there for a member', () => {
    mocks.role = 'member'
    renderPage()
    expect(screen.queryByRole('region', { name: 'Archive' })).toBeNull()
  })

  it('is there for a site admin who is a member', () => {
    mocks.role = 'member'
    mocks.siteAdmin = true
    renderPage()
    expect(within(section()).getByRole('button', { name: 'Archive team…' })).toBeTruthy()
  })

  it('offers Unarchive on an archived team, and nothing else changes', async () => {
    mocks.archivedAt = '2026-09-30T10:00:00Z'
    const user = renderPage()
    expect(within(section()).getByText('Unarchive Engineering')).toBeTruthy()
    expect(within(section()).queryByRole('button', { name: 'Archive team…' })).toBeNull()
    // The rest of General reads as it is.
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Every member/ }).disabled).toBe(
      true,
    )

    await user.click(within(section()).getByRole('button', { name: 'Unarchive team' }))
    expect(mocks.update).toHaveBeenCalledWith({ teamId: 7, data: { archived: false } })
  })
})

describe('the archive dialog (frame 2)', () => {
  it('counts what stops before anything happens', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Archive team…' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Archive Engineering?' }))
    expect(
      dialog.getByText(
        'The team becomes read-only for its 8 members. Nothing is deleted, and unarchiving puts it back exactly as it was.',
      ),
    ).toBeTruthy()
    expect(dialog.getByText('These stop while it is archived')).toBeTruthy()
    expect(
      dialog.getByText('3 automation rules · 1 webhook · 2 repository links · 1 recurring ticket'),
    ).toBeTruthy()
    expect(dialog.getByText('14 open tickets stay open and assigned.')).toBeTruthy()
    expect(mocks.update).not.toHaveBeenCalled()

    await user.click(dialog.getByRole('button', { name: 'Archive team' }))
    expect(mocks.update).toHaveBeenCalledWith({ teamId: 7, data: { archived: true } })
  })

  it('leaves out what there is none of, in the singular where there is one', async () => {
    mocks.preview = {
      ...PREVIEW,
      members: 1,
      automation_rules: 1,
      webhooks: 0,
      repository_links: 0,
      recurring_tickets: 2,
      open_tickets: 1,
    }
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Archive team…' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText(/read-only for its 1 member\./)).toBeTruthy()
    expect(dialog.getByText('1 automation rule · 2 recurring tickets')).toBeTruthy()
    expect(dialog.getByText('1 open ticket stays open and assigned.')).toBeTruthy()
  })

  it('Cancel archives nothing', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Archive team…' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.update).not.toHaveBeenCalled()
  })
})

describe('deleting an empty team', () => {
  it('asks, deletes, and goes to a team still in use', async () => {
    mocks.preview = { ...PREVIEW, tickets: 0, open_tickets: 0 }
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const queryClient = new QueryClient()
    queryClient.setQueryData(
      ['/teams'],
      [
        { id: 7, key: 'ENG', name: 'Engineering', archived_at: null },
        { id: 8, key: 'OLD', name: 'Old', archived_at: '2026-01-01T00:00:00Z' },
        { id: 9, key: 'OPS', name: 'Operations', archived_at: null },
      ],
    )
    const user = renderPage(queryClient)
    expect(
      screen.getByText('Only for a team with no tickets. Engineering has none, so it can be deleted.'),
    ).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Delete team' }))
    expect(window.confirm).toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenCalledWith({ teamId: 7 })
    expect(await screen.findByText('Board of the next team')).toBeTruthy()
  })

  it('deletes nothing when the question is answered no', async () => {
    mocks.preview = { ...PREVIEW, tickets: 0 }
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Delete team' }))
    expect(mocks.remove).not.toHaveBeenCalled()
  })
})

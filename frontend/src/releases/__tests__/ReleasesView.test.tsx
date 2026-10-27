// @vitest-environment jsdom
/**
 * Releases (#272): the tab's list and a release's page -- its state, target
 * date and progress, what is not done before what is -- releasing, which
 * asks about the rest, and the drafted notes.
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
  TicketRead,
} from '@/api/generated/models'
import { ReleasesView } from '@/releases/ReleasesView'
import { TeamProvider, type TeamContextValue } from '@/team/TeamContext'

const mocks = vi.hoisted(() => ({
  tickets: [] as unknown[],
  asked: [] as unknown[],
  release: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  notes: '# 1.4.0\n\n## Stories\n\n- Portal: invoice list page (ENG-10)\n',
}))

vi.mock('@/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 10 } }) }))
vi.mock('@/api/generated/endpoints/tickets/tickets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/tickets/tickets')>()),
  useListTicketsTeamsTeamIdTicketsGet: (_teamId: number, params: unknown) => {
    mocks.asked.push(params)
    return { data: { items: mocks.tickets, total: mocks.tickets.length }, isLoading: false }
  },
}))
vi.mock('@/api/generated/endpoints/releases/releases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/releases/releases')>()),
  useReleaseReleaseReleasesReleaseIdReleasePost: () => ({
    mutateAsync: mocks.release,
    isPending: false,
  }),
  useUpdateReleaseReleasesReleaseIdPatch: () => ({ mutateAsync: mocks.update, isPending: false }),
  useCreateReleaseTeamsTeamIdReleasesPost: () => ({ mutateAsync: mocks.create, isPending: false }),
  useDeleteReleaseReleasesReleaseIdDelete: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReleaseNotesReleasesReleaseIdNotesGet: () => ({
    data: { markdown: mocks.notes },
    isLoading: false,
    isError: false,
  }),
}))

function status(id: number, name: string, category: StatusRead['category']): StatusRead {
  return { id, team_id: 7, name, category, position: id, color: '#888' }
}
const TODO = status(1, 'Todo', 'unstarted')
const DONE = status(2, 'Done', 'done')

function release(
  id: number,
  name: string,
  overrides: Partial<ReleaseRead> = {},
): ReleaseRead {
  return {
    id,
    team_id: 7,
    name,
    state: 'planned',
    created_at: '2026-09-01T00:00:00Z',
    progress: {
      tickets_total: 0,
      tickets_done: 0,
      points_total: 0,
      points_done: 0,
      tickets_unestimated: 0,
    },
    ...overrides,
  }
}

const NEXT = release(5, '1.5.0')
const CURRENT = release(4, '1.4.0', {
  description: 'The customer portal, for the first three customers.',
  target_date: '2026-10-15',
  progress: {
    tickets_total: 5,
    tickets_done: 3,
    points_total: 16,
    points_done: 11,
    tickets_unestimated: 0,
  },
})
const SHIPPED = release(3, '1.3.2', { state: 'released', released_on: '2026-09-20' })
const PUT_AWAY = release(1, '0.9.0', { state: 'archived', released_on: '2026-03-01' })

const AMINA: TeamMemberRead = {
  role: 'admin',
  joined_at: '2026-01-01T00:00:00Z',
  user: {
    id: 10,
    email: 'amina@x.dev',
    username: 'amina',
    full_name: 'Amina Khan',
    avatar_color: '#123',
    is_active: true,
  },
}

function ticket(id: number, title: string, inStatus: StatusRead): TicketRead {
  return {
    id,
    team_id: 7,
    team_key: 'ENG',
    number: id,
    identifier: `ENG-${id}`,
    title,
    status: inStatus,
    priority: 'no_priority',
    type: 'story',
    rank: 'a0',
    blocked_by_count: 0,
    custom_fields: {},
    child_count: 0,
    completed_child_count: 0,
    creator: AMINA.user,
    labels: [],
    fix_version_id: CURRENT.id,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as TicketRead
}

function renderReleases({
  releases = [CURRENT, NEXT, SHIPPED, PUT_AWAY],
  role = 'admin',
}: { releases?: ReleaseRead[]; role?: TeamMemberRead['role'] } = {}) {
  const team: TeamContextValue = {
    team: { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' },
    teams: [],
    projects: [],
    labels: [],
    members: [{ ...AMINA, role }],
    sprints: [],
    statuses: [TODO, DONE],
    releases,
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamProvider value={team}>
        <MemoryRouter>
          <ReleasesView />
        </MemoryRouter>
      </TeamProvider>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.tickets = [
    ticket(12, 'Regression pass for portal release', TODO),
    ticket(10, 'Portal: invoice list page', DONE),
  ]
  mocks.asked = []
  mocks.release.mockReset().mockResolvedValue({
    release: { ...CURRENT, state: 'released' },
    moved: 1,
    moved_to_release_id: NEXT.id,
  })
  mocks.update.mockReset().mockResolvedValue(CURRENT)
  mocks.create.mockReset().mockResolvedValue(release(6, '2.0.0'))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the list', () => {
  it('lists what is to come, then what shipped, and the archived apart', () => {
    renderReleases()
    const list = screen.getByRole('navigation', { name: 'Releases' })
    const names = within(list)
      .getAllByRole('button')
      .map((button) => button.textContent)
    expect(names).toEqual(['New release', '1.4.015 Oct', '1.5.0planned', '1.3.2released', '0.9.0'])
    expect(within(list).getByRole('heading', { name: 'Archived' })).toBeTruthy()
  })

  it('opens on the release coming next, ahead of one with no date yet', () => {
    // The list puts the undated 1.5.0 first; 1.4.0 is the one due.
    renderReleases({ releases: [NEXT, CURRENT, SHIPPED] })
    expect(screen.getByRole('heading', { level: 2, name: '1.4.0' })).toBeTruthy()
    expect(mocks.asked.at(-1)).toEqual({ fix_version_id: [CURRENT.id], limit: 200 })
  })

  it('says what a release is to a team with none', () => {
    renderReleases({ releases: [] })
    expect(screen.getByText('No releases yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New release' })).toBeTruthy()
  })

  it('makes a release and opens it', async () => {
    const user = renderReleases()
    await user.click(screen.getByRole('button', { name: 'New release' }))
    const dialog = screen.getByRole('dialog', { name: 'New release' })
    await user.type(within(dialog).getByLabelText('Name'), ' 2.0.0 ')
    await user.click(within(dialog).getByRole('button', { name: 'Create release' }))
    expect(mocks.create).toHaveBeenCalledWith({
      teamId: 7,
      data: { name: '2.0.0', description: null, target_date: null },
    })
  })
})

describe('a release’s page', () => {
  it('shows its state, target and progress in points and tickets', () => {
    renderReleases()
    const page = screen.getByRole('region', { name: '1.4.0' })
    expect(within(page).getByText('Planned')).toBeTruthy()
    expect(
      within(page).getByText(
        'The customer portal, for the first three customers. Target 15 Oct 2026.',
      ),
    ).toBeTruthy()
    expect(within(page).getByText('11 of 16 pts · 3 of 5 tickets')).toBeTruthy()
    expect(within(page).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('69')
  })

  it('lists what is not done yet before what is done', () => {
    renderReleases()
    const page = screen.getByRole('region', { name: '1.4.0' })
    const headings = within(page)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)
    expect(headings).toEqual(['Not done yet1', 'Done1'])
  })

  it('offers a guest the notes, and nothing that changes it', () => {
    renderReleases({ role: 'guest' })
    expect(screen.queryByRole('button', { name: 'New release' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Release' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'More actions for 1.4.0' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Release notes' })).toBeTruthy()
  })

  it('archives a release from its menu', async () => {
    const user = renderReleases()
    await user.click(screen.getByRole('button', { name: 'More actions for 1.4.0' }))
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }))
    expect(mocks.update).toHaveBeenCalledWith({ releaseId: 4, data: { state: 'archived' } })
  })
})

describe('releasing', () => {
  it('asks about what is not done, and moves it to the next release by default', async () => {
    const user = renderReleases()
    await user.click(screen.getByRole('button', { name: 'Release' }))
    const dialog = screen.getByRole('dialog', { name: 'Release 1.4.0' })
    // On the body, not inside the release's glass panel, whose
    // backdrop-filter would clip a fixed overlay to the panel.
    expect(dialog.parentElement?.parentElement).toBe(document.body)
    expect(within(dialog).getByText('2 tickets', { exact: false })).toBeTruthy()
    expect(
      (within(dialog).getByRole('radio', { name: 'Move them to the next release' }) as HTMLInputElement)
        .checked,
    ).toBe(true)
    expect(
      (within(dialog).getByRole('combobox', { name: 'The release to move them to' }) as HTMLSelectElement)
        .value,
    ).toBe(String(NEXT.id))

    const day = within(dialog).getByLabelText('Released on')
    await user.clear(day)
    await user.type(day, '2026-10-15')
    await user.click(within(dialog).getByRole('button', { name: 'Release' }))
    expect(mocks.release).toHaveBeenCalledWith({
      releaseId: CURRENT.id,
      data: { released_on: '2026-10-15', move_to_release_id: NEXT.id },
    })
  })

  it('can leave them without a release', async () => {
    const user = renderReleases()
    await user.click(screen.getByRole('button', { name: 'Release' }))
    const dialog = screen.getByRole('dialog', { name: 'Release 1.4.0' })
    await user.click(within(dialog).getByRole('radio', { name: 'Leave them without a release' }))
    await user.click(within(dialog).getByRole('button', { name: 'Release' }))
    expect(mocks.release.mock.calls[0][0].data.move_to_release_id).toBeNull()
  })

  it('has nowhere to move them when no other release is planned', async () => {
    const user = renderReleases({ releases: [CURRENT, SHIPPED] })
    await user.click(screen.getByRole('button', { name: 'Release' }))
    const dialog = screen.getByRole('dialog', { name: 'Release 1.4.0' })
    expect(
      (within(dialog).getByRole('radio', { name: 'Move them to the next release' }) as HTMLInputElement)
        .disabled,
    ).toBe(true)
    expect(within(dialog).getByText('There is no other planned release to move them to.')).toBeTruthy()
  })
})

describe('release notes', () => {
  it('shows the draft to edit, copy or download', async () => {
    const user = renderReleases()
    await user.click(screen.getByRole('button', { name: 'Release notes' }))
    const dialog = screen.getByRole('dialog', { name: 'Release notes · 1.4.0' })
    const text = within(dialog).getByRole('textbox', {
      name: 'Release notes in markdown',
    }) as HTMLTextAreaElement
    expect(text.value).toBe(mocks.notes)
    await user.type(text, 'Thanks to everyone.')
    expect(text.value.endsWith('Thanks to everyone.')).toBe(true)
    expect(within(dialog).getByRole('button', { name: 'Copy' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Download' })).toBeTruthy()
  })
})

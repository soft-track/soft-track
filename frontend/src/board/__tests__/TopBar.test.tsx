// @vitest-environment jsdom
/**
 * The top bar's Export CSV button, driven the way a person drives it.
 *
 * The button is not exported on its own, so every test goes through `TopBar`
 * -- which is also the only place that decides what `searching` means. The
 * download itself is the part with no DOM to assert against: the anchor is
 * created, clicked and removed inside one handler, so `click` is spied on the
 * prototype and the element is read from `this` while it is still mounted.
 *
 * `AXIOS_INSTANCE.get` is spied rather than the module replaced: the export
 * reaches for the raw instance because a blob needs `responseType`, and a
 * whole-module mock would take `apiClient` out from under every generated
 * hook that imports it too.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { AXIOS_INSTANCE } from '@/api/client'
import type { CycleRead, LabelRead, ProjectRead, StatusRead, TeamMemberRead } from '@/api/generated/models'
import { NO_FILTERS, type BoardFilters } from '@/board/filters'
import { TopBar } from '@/board/TopBar'
import { TeamProvider, type TeamContextValue } from '@/team/TeamContext'

// The bell polls an endpoint every minute, which has nothing to do with the
// export and would be the only thing in this file touching the network.
vi.mock('@/notifications/useNotifications', () => ({
  useUnreadCount: () => 0,
}))

const OBJECT_URL = 'blob:http://localhost/issues-csv'

function status(id: number, name: string): StatusRead {
  return { id, team_id: 7, name, category: 'unstarted', position: id, color: '#888' }
}

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

const PROJECT: ProjectRead = {
  id: 5,
  team_id: 7,
  name: 'Platform',
  color: '#123',
  created_at: '2026-01-01T00:00:00Z',
}

const LABEL: LabelRead = { id: 4, team_id: 7, name: 'Bug', color: '#456' }

const CYCLE: CycleRead = {
  id: 6,
  team_id: 7,
  number: 1,
  display_name: 'Cycle 1',
  starts_at: '2026-01-05T09:00:00Z',
  ends_at: '2026-01-19T09:00:00Z',
  state: 'active',
  progress: {
    issues_total: 0,
    issues_completed: 0,
    points_total: 0,
    points_completed: 0,
    issues_unestimated: 0,
  },
}

const TEAM: TeamContextValue = {
  team: { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' },
  teams: [],
  projects: [PROJECT],
  labels: [LABEL],
  members: [member(10, 'Ada Lovelace')],
  cycles: [CYCLE],
  statuses: [status(1, 'Todo'), status(3, 'In Progress')],
}

/** Every filter set at once, so one export pins the whole mapping. */
const ALL_FILTERS: BoardFilters = {
  statusId: 3,
  priority: 'high',
  assignee: 'unassigned',
  labelId: LABEL.id,
  projectId: PROJECT.id,
  cycleId: CYCLE.id,
}

function renderTopBar({
  filters = NO_FILTERS,
  search = '',
}: { filters?: BoardFilters; search?: string } = {}) {
  render(
    <TeamProvider value={TEAM}>
      <TopBar
        view="board"
        onViewChange={vi.fn()}
        onNewIssue={vi.fn()}
        onOpenSidebar={vi.fn()}
        search={search}
        onSearchChange={vi.fn()}
        filters={filters}
        onFiltersChange={vi.fn()}
        onSaveView={vi.fn()}
        canSaveView={false}
        notificationsOpen={false}
        onToggleNotifications={vi.fn()}
        onCloseNotifications={vi.fn()}
      />
    </TeamProvider>,
  )
  return userEvent.setup()
}

const exportButton = () => screen.getByRole<HTMLButtonElement>('button', { name: /^Export/ })

/** The one request the export made, split into its path and its parameters. */
function requestedUrl() {
  expect(get).toHaveBeenCalledTimes(1)
  const [url, config] = get.mock.calls[0]
  const [path, query = ''] = String(url).split('?')
  return { path, params: Object.fromEntries(new URLSearchParams(query)), config }
}

type Download = { href: string | null; download: string; mounted: boolean }

let get: MockInstance
let createObjectURL: ReturnType<typeof vi.fn>
let revokeObjectURL: ReturnType<typeof vi.fn>
let downloads: Download[]

beforeEach(() => {
  get = vi.spyOn(AXIOS_INSTANCE, 'get')
  get.mockResolvedValue({ data: new Blob(['key,title\r\n'], { type: 'text/csv' }) })

  // jsdom implements neither, and the export would throw on the first one.
  createObjectURL = vi.fn(() => OBJECT_URL)
  revokeObjectURL = vi.fn()
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL

  // The anchor never survives the handler, so it is recorded mid-click.
  // Stubbed for every test rather than just the one that reads it: a real
  // click on a blob: href is a navigation jsdom cannot do, and it would log
  // "Not implemented" from each test that exports successfully.
  downloads = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({
      href: this.getAttribute('href'),
      download: this.download,
      mounted: document.body.contains(this),
    })
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TopBar export', () => {
  it('offers the export', () => {
    renderTopBar()
    const button = exportButton()
    expect(button.textContent).toContain('Export CSV')
    expect(button.disabled).toBe(false)
    expect(button.title).toBe('Download these issues as CSV')
  })

  it("asks the export endpoint for the team's issues", async () => {
    const user = renderTopBar()
    await user.click(exportButton())

    const { path, params, config } = requestedUrl()
    expect(path).toBe('/teams/7/issues/export')
    // Nothing is filtered, so nothing is narrowed: an empty query string
    // rather than a parameter set to nothing.
    expect(params).toEqual({})
    expect(config).toEqual({ responseType: 'blob' })
  })

  it('sends the filters that are showing on the board', async () => {
    const user = renderTopBar({ filters: ALL_FILTERS })
    await user.click(exportButton())

    const { path, params } = requestedUrl()
    expect(path).toBe('/teams/7/issues/export')
    expect(params).toEqual({
      status_id: '3',
      priority: 'high',
      // "Nobody" is its own parameter, not an assignee_id the API would have
      // to guess at.
      unassigned: 'true',
      label_id: '4',
      project_id: '5',
      cycle_id: '6',
    })
    expect(params.assignee_id).toBeUndefined()
  })

  it('sends a named assignee as an id', async () => {
    const user = renderTopBar({ filters: { ...NO_FILTERS, assignee: 10 } })
    await user.click(exportButton())

    expect(requestedUrl().params).toEqual({ assignee_id: '10' })
  })

  it('hands the returned CSV to the browser as a download', async () => {
    const csv = new Blob(['key,title\r\nENG-1,Fix login\r\n'], { type: 'text/csv' })
    get.mockResolvedValue({ data: csv })

    const user = renderTopBar()
    await user.click(exportButton())

    await waitFor(() => expect(downloads).toHaveLength(1))
    expect(createObjectURL).toHaveBeenCalledWith(csv)
    expect(downloads[0]).toEqual({
      href: OBJECT_URL,
      download: 'issues.csv',
      // Firefox ignores a click on an anchor that is not in the document.
      mounted: true,
    })
    // Released rather than leaked: the blob is held until it is revoked, and
    // this one has done its whole job by the time the click returns.
    expect(revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL)
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('says so while the export is in flight, and takes no second request', async () => {
    let finish: (value: { data: Blob }) => void = () => {}
    get.mockReturnValue(
      new Promise<{ data: Blob }>((resolve) => {
        finish = resolve
      }),
    )

    const user = renderTopBar()
    await user.click(exportButton())

    const pending = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Exporting…',
    })
    expect(pending.disabled).toBe(true)
    await user.click(pending)
    expect(get).toHaveBeenCalledTimes(1)

    finish({ data: new Blob(['key\r\n'], { type: 'text/csv' }) })
    await waitFor(() => expect(exportButton().textContent).toContain('Export CSV'))
  })

  it('is disabled while a search is running, and exports nothing', async () => {
    const user = renderTopBar({ filters: ALL_FILTERS, search: 'login' })

    const button = exportButton()
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    // Search replaces the board with /search hits the export knows nothing
    // about, so the filters alone would export something plausible and wrong.
    expect(button.title).toMatch(/Clear the search to export/)

    await user.click(button)
    expect(get).not.toHaveBeenCalled()
  })

  it('stays available when the search box holds only whitespace', () => {
    renderTopBar({ search: '   ' })
    expect(exportButton().disabled).toBe(false)
  })

  it('reports a failed export on the button itself', async () => {
    get.mockRejectedValue(new Error('500'))
    const user = renderTopBar()

    await user.click(exportButton())

    const failed = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Export failed',
    })
    expect(failed.title).toBe('The export failed. Try again.')
    // Failed, not stuck: the button is live again for a retry.
    expect(failed.disabled).toBe(false)
    expect(createObjectURL).not.toHaveBeenCalled()

    get.mockResolvedValue({ data: new Blob(['key\r\n'], { type: 'text/csv' }) })
    await user.click(failed)

    await waitFor(() => expect(exportButton().textContent).toContain('Export CSV'))
    expect(get).toHaveBeenCalledTimes(2)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
  })
})

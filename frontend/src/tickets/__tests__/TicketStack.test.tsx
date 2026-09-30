// @vitest-environment jsdom
/**
 * A linked ticket opens in a modal over the one you are reading (#114),
 * rather than taking its place: at the same address, one Escape or one Back
 * closing one modal, focus going back to the row it came from, two deep at
 * most, and the ticket underneath refreshed when it closes.
 *
 * The panel and the page are real; the body is a stand-in with a row per
 * link and a Status field, since the sections are their own subject.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TeamRead, TicketRead } from '@/api/generated/models'
import { TeamProvider } from '@/team/TeamContext'
import { useTeamContext, type TeamContextValue } from '@/team/useTeamContext'
import { modalsIn } from '@/tickets/modals'
import { useRelatedTickets } from '@/tickets/stackContext'
import { surfaceFor, TicketSurfaceContext } from '@/tickets/surface'
import { TicketDetailPanel } from '@/tickets/TicketDetailPanel'
import { TicketStack } from '@/tickets/TicketStack'
import { useFocusTrap } from '@/ui/useFocusTrap'

const ENG: TeamRead = { id: 5, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' }
const OPS: TeamRead = { id: 6, name: 'Operations', key: 'OPS', created_at: '2026-01-01T00:00:00Z' }
const TODO = { id: 1, team_id: 5, name: 'Todo', category: 'unstarted', position: 0, color: '#888' }

function ticket(team: TeamRead, number: number, title: string): TicketRead {
  return {
    id: number * 10 + (team === OPS ? 1 : 0),
    team_id: team.id,
    team_key: team.key,
    number,
    identifier: `${team.key}-${number}`,
    title,
    status: TODO,
  } as unknown as TicketRead
}

const IMPORT = ticket(ENG, 20, 'Import a Jira CSV export')
const STATUSES = ticket(ENG, 25, 'Per-team custom statuses')
const BURNDOWN = ticket(ENG, 12, 'Status categories in the burndown')
const FLAT = ticket(ENG, 9, 'Burndown flat-lines with no estimates')
const RUNBOOK = ticket(OPS, 3, 'Runbook for the import')

/**
 * What each ticket links to, as the stand-in body lists it. Every link shows
 * on both of its tickets, so the blocker lists what it blocks.
 */
const LINKS = new Map<number, TicketRead[]>([
  [IMPORT.id, [STATUSES, RUNBOOK]],
  [STATUSES.id, [IMPORT, BURNDOWN]],
  [BURNDOWN.id, [STATUSES, IMPORT, FLAT]],
])

const mocks = vi.hoisted(() => ({
  tickets: new Map<number, unknown>(),
  refused: new Set<number>(),
}))

vi.mock('@/api/generated/endpoints/tickets/tickets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/tickets/tickets')>()),
  useGetTicketTicketsTicketIdGet: (id: number) =>
    mocks.refused.has(id)
      ? { data: undefined, error: { response: { status: 403 } } }
      : { data: mocks.tickets.get(id), error: null },
}))

vi.mock('@/team/useTeams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/team/useTeams')>()),
  useTeamByKey: (key: string | undefined) => ({
    team: [ENG, OPS].find((team) => team.key === key),
    teams: [ENG, OPS],
    isLoading: false,
    isError: false,
  }),
}))

vi.mock('@/team/useTeamData', () => ({
  useTeamData: () => ({ projects: [], labels: [], members: [], sprints: [], statuses: [] }),
}))

vi.mock('@/tickets/TicketHeaderActions', () => ({ TicketHeaderActions: () => null }))

// A row per link, opened the way the real sections open them, and a field
// for S to find.
vi.mock('@/tickets/TicketDetailBody', () => ({
  TicketBodySkeleton: () => null,
  TicketDetailBody: ({ ticketId }: { ticketId: number }) => {
    const related = useRelatedTickets()
    const { team } = useTeamContext()
    const here = mocks.tickets.get(ticketId) as TicketRead
    return (
      <div>
        <p>
          Body of {here.identifier}, read on team {team.key}
        </p>
        <button type="button" data-field="status">
          Status of {here.identifier}
        </button>
        {(LINKS.get(ticketId) ?? []).map((linked) => {
          const opens = related.opens(linked.id)
          return (
            <button
              key={linked.id}
              type="button"
              aria-expanded={opens === 'modal' ? related.openAbove === linked.id : undefined}
              onClick={(event) => related.open(linked, event.currentTarget)}
            >
              {linked.identifier} {linked.title}
              {opens === 'page' && ' (opens the page)'}
              {opens === 'back' && ' (goes back)'}
            </button>
          )
        })}
      </div>
    )
  },
}))

const TEAM: TeamContextValue = {
  team: ENG,
  teams: [ENG, OPS],
  projects: [],
  labels: [],
  members: [],
  sprints: [],
  statuses: [TODO],
} as unknown as TeamContextValue

/** Where the router is: the address, the surface, and how many modals the entry holds. */
function Where() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <output
        data-testid="where"
        data-surface={surfaceFor(location.state)}
        data-modals={modalsIn(location.state).length}
      >
        {location.pathname}
      </output>
      {/* The browser's Back button. */}
      <button type="button" onClick={() => navigate(-1)}>
        Browser back
      </button>
    </>
  )
}

/**
 * A dialog of the board's own, like the cheatsheet: opened over whatever is
 * there, and closed on Escape by a window listener of its own -- the board's
 * overlay stack, which knows nothing of tickets.
 */
function Cheatsheet() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Show the shortcuts
      </button>
      {open && <CheatsheetDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function CheatsheetDialog({ onClose }: { onClose: () => void }) {
  const ref = useFocusTrap<HTMLDivElement>()
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  return (
    <div role="dialog" aria-modal="true" aria-label="Shortcuts" tabIndex={-1} ref={ref}>
      <button type="button">Got it</button>
    </div>
  )
}

/** The panel while the entry asks for it, as TeamRoute has it; the page's stand-in otherwise. */
function PanelOrPage({ onClose, openPage }: { onClose: () => void; openPage?: () => void }) {
  const location = useLocation()
  if (surfaceFor(location.state) === 'page') return <p>The page for {location.pathname}</p>
  return <TicketDetailPanel ticketId={IMPORT.id} onClose={onClose} openPage={openPage} />
}

function renderPanel(props: { onClose?: () => void; openPage?: () => void } = {}) {
  const onClose = props.onClose ?? vi.fn()
  const queryClient = new QueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={['/ENG', { pathname: '/ENG/ticket/20', state: { ticketSurface: 'panel' } }]}
      >
        <TeamProvider value={TEAM}>
          <Routes>
            <Route path="/ENG" element={<p>The board</p>} />
            <Route
              path="/ENG/ticket/:n"
              element={<PanelOrPage onClose={onClose} openPage={props.openPage} />}
            />
          </Routes>
          <Where />
          <Cheatsheet />
        </TeamProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { onClose, queryClient, user: userEvent.setup() }
}

const panel = () => screen.getByRole('dialog', { name: 'ENG-20 Import a Jira CSV export' })
const modal = (name: RegExp) => screen.getByRole('dialog', { name })
const where = () => screen.getByTestId('where')

beforeEach(() => {
  mocks.tickets = new Map([IMPORT, STATUSES, BURNDOWN, FLAT, RUNBOOK].map((t) => [t.id, t]))
  mocks.refused = new Set()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('a linked ticket opened from the panel', () => {
  it('opens in a modal over the panel, at the same address', async () => {
    const { user } = renderPanel()
    await user.click(within(panel()).getByRole('button', { name: /ENG-25/ }))

    const opened = modal(/^ENG-25 Per-team custom statuses$/)
    expect(within(opened).getByText('Body of ENG-25, read on team ENG')).toBeTruthy()
    // The ticket you were reading is still there, under it.
    expect(within(panel()).getByText('Body of ENG-20, read on team ENG')).toBeTruthy()
    expect(where().textContent).toBe('/ENG/ticket/20')
    expect(where().dataset.surface).toBe('panel')
    expect(where().dataset.modals).toBe('1')
  })

  it('says where it was opened from, and marks the row it came from', async () => {
    const { user } = renderPanel()
    const row = within(panel()).getByRole('button', { name: /ENG-25/ })
    expect(row.getAttribute('aria-expanded')).toBe('false')

    await user.click(row)

    expect(
      within(modal(/^ENG-25/)).getByRole('button', { name: 'from ENG-20' }).getAttribute('title'),
    ).toBe('Back to ENG-20')
    expect(row.getAttribute('aria-expanded')).toBe('true')
  })

  it('closes on Escape, and only the modal: focus goes back to the row', async () => {
    const { user, onClose } = renderPanel()
    const row = within(panel()).getByRole('button', { name: /ENG-25/ })
    await user.click(row)

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: /^ENG-25/ })).toBeNull()
    expect(panel()).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(row)
    expect(where().dataset.modals).toBe('0')

    // And the next Escape is the panel's.
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Back, rather than leaving the ticket', async () => {
    const { user } = renderPanel()
    await user.click(within(panel()).getByRole('button', { name: /ENG-25/ }))

    await user.click(screen.getByRole('button', { name: 'Browser back' }))

    expect(screen.queryByRole('dialog', { name: /^ENG-25/ })).toBeNull()
    expect(panel()).toBeTruthy()
    expect(where().textContent).toBe('/ENG/ticket/20')
  })

  it('leaves no entry behind when closed with its button: the next Back leaves the ticket', async () => {
    const { user } = renderPanel()
    await user.click(within(panel()).getByRole('button', { name: /ENG-25/ }))
    await user.click(within(modal(/^ENG-25/)).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: /^ENG-25/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Browser back' }))
    expect(screen.getByText('The board')).toBeTruthy()
  })

  it('closes from its “from” chip and from a click on its scrim', async () => {
    const { user } = renderPanel()
    await user.click(within(panel()).getByRole('button', { name: /ENG-25/ }))
    await user.click(within(modal(/^ENG-25/)).getByRole('button', { name: 'from ENG-20' }))
    expect(screen.queryByRole('dialog', { name: /^ENG-25/ })).toBeNull()

    await user.click(within(panel()).getByRole('button', { name: /ENG-25/ }))
    await user.click(modal(/^ENG-25/).parentElement!)
    expect(screen.queryByRole('dialog', { name: /^ENG-25/ })).toBeNull()
    // The panel's own scrim never heard the click.
    expect(panel()).toBeTruthy()
  })

  it('leaves Escape to a dialog opened over it, which closes alone', async () => {
    const { user, onClose } = renderPanel()
    await user.click(within(panel()).getByRole('button', { name: /ENG-25/ }))
    await user.click(screen.getByRole('button', { name: 'Show the shortcuts' }))

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'Shortcuts' })).toBeNull()
    expect(modal(/^ENG-25/)).toBeTruthy()
    expect(where().dataset.modals).toBe('1')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /^ENG-25/ })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('sends S, P, A and L to the ticket on top', async () => {
    const { user } = renderPanel()
    await user.click(within(panel()).getByRole('button', { name: /ENG-25/ }))

    await user.keyboard('s')

    expect(document.activeElement?.textContent).toBe('Status of ENG-25')
  })

  it('goes back to the panel from the blocker’s own row for it, rather than a second copy', async () => {
    const { user } = renderPanel()
    await user.click(within(panel()).getByRole('button', { name: /ENG-25/ }))

    await user.click(
      within(modal(/^ENG-25/)).getByRole('button', { name: /^ENG-20 .*\(goes back\)$/ }),
    )

    expect(screen.queryByRole('dialog', { name: /^ENG-25/ })).toBeNull()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(where().dataset.modals).toBe('0')
  })

  it('refreshes the ticket underneath when it closes, whatever changed up there', async () => {
    const { user, queryClient } = renderPanel()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await user.click(within(panel()).getByRole('button', { name: /ENG-25/ }))
    invalidate.mockClear()

    await user.keyboard('{Escape}')

    const predicates = invalidate.mock.calls.map(([filters]) => filters?.predicate)
    const about = (path: string) =>
      predicates.some((predicate) => predicate?.({ queryKey: [path] } as never))
    expect(about('/tickets/200')).toBe(true)
    expect(about('/tickets/200/links')).toBe(true)
    expect(about('/tickets/2000')).toBe(false)
    expect(about('/tickets/250')).toBe(false)
  })
})

describe('a change still on its way when the modal closes', () => {
  it('refreshes the ticket underneath again once it has landed', async () => {
    const { user, queryClient } = renderPanel()
    await user.click(within(panel()).getByRole('button', { name: /ENG-25/ }))
    // Done picked, and the save not back yet.
    let land = () => {}
    const saving = queryClient.getMutationCache().build(queryClient, {
      mutationFn: () => new Promise<void>((resolve) => (land = resolve)),
    })
    void saving.execute(undefined)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await user.keyboard('{Escape}')
    expect(invalidate).toHaveBeenCalledTimes(1)

    await act(async () => land())
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2))
    const [, [again]] = invalidate.mock.calls
    expect(again?.predicate?.({ queryKey: ['/tickets/200/links'] } as never)).toBe(true)
  })
})

describe('two modals deep', () => {
  async function twoDeep(props: { openPage?: () => void } = {}) {
    const rendered = renderPanel(props)
    await rendered.user.click(within(panel()).getByRole('button', { name: /ENG-25/ }))
    await rendered.user.click(within(modal(/^ENG-25/)).getByRole('button', { name: /ENG-12/ }))
    return rendered
  }

  it('stacks a second modal that names the whole trail', async () => {
    await twoDeep()

    const second = modal(/^ENG-12 Status categories in the burndown$/)
    expect(within(second).getByRole('button', { name: 'ENG-20 › ENG-25' })).toBeTruthy()
    expect(modal(/^ENG-25/)).toBeTruthy()
    expect(where().dataset.modals).toBe('2')
    expect(where().textContent).toBe('/ENG/ticket/20')
  })

  it('closes one at a time, each time back on the row that opened it', async () => {
    const { user } = await twoDeep()
    const inFirst = within(modal(/^ENG-25/)).getByRole('button', { name: /ENG-12/ })

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /^ENG-12/ })).toBeNull()
    expect(document.activeElement).toBe(inFirst)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /^ENG-25/ })).toBeNull()
    expect(document.activeElement).toBe(within(panel()).getByRole('button', { name: /ENG-25/ }))
  })

  it('opens a link from the second modal as a page, not a third modal', async () => {
    const { user } = await twoDeep()

    await user.click(
      within(modal(/^ENG-12/)).getByRole('button', { name: /ENG-9 .*\(opens the page\)/ }),
    )

    expect(where().textContent).toBe('/ENG/ticket/9')
    expect(where().dataset.surface).toBe('page')
    expect(screen.getByText('The page for /ENG/ticket/9')).toBeTruthy()
  })

  it('leaves for the page the surface’s own way, when it has one', async () => {
    const openPage = vi.fn()
    const { user } = await twoDeep({ openPage })

    await user.click(within(modal(/^ENG-12/)).getByRole('button', { name: /ENG-9/ }))

    expect(openPage).toHaveBeenCalledWith(expect.objectContaining({ team_key: 'ENG', number: 9 }))
  })

  it('goes back down to a ticket open beneath, rather than opening it again', async () => {
    const { user } = await twoDeep()

    // ENG-12's parent is the modal under it.
    await user.click(
      within(modal(/^ENG-12/)).getByRole('button', { name: /^ENG-25 .*\(goes back\)$/ }),
    )
    expect(screen.queryByRole('dialog', { name: /^ENG-12/ })).toBeNull()
    expect(modal(/^ENG-25/)).toBeTruthy()
    expect(where().dataset.modals).toBe('1')
    expect(where().dataset.surface).toBe('panel')
  })

  it('goes back two when the ticket is the one in the panel', async () => {
    const { user } = await twoDeep()

    await user.click(
      within(modal(/^ENG-12/)).getByRole('button', { name: /^ENG-20 .*\(goes back\)$/ }),
    )
    expect(screen.queryByRole('dialog', { name: /^ENG-12/ })).toBeNull()
    expect(screen.queryByRole('dialog', { name: /^ENG-25/ })).toBeNull()
    expect(panel()).toBeTruthy()
    expect(where().dataset.modals).toBe('0')
    expect(where().textContent).toBe('/ENG/ticket/20')
    // On the row the first of them was opened from.
    expect(document.activeElement).toBe(within(panel()).getByRole('button', { name: /ENG-25/ }))
  })

  it('takes Back one modal at a time', async () => {
    const { user } = await twoDeep()
    await user.click(screen.getByRole('button', { name: 'Browser back' }))
    expect(screen.queryByRole('dialog', { name: /^ENG-12/ })).toBeNull()
    expect(modal(/^ENG-25/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Browser back' }))
    expect(screen.queryByRole('dialog', { name: /^ENG-25/ })).toBeNull()
    expect(panel()).toBeTruthy()
  })
})

describe('a modal’s way out to the page', () => {
  it('is a link to the page, which a plain click follows the surface’s way', async () => {
    const openPage = vi.fn()
    const { user } = renderPanel({ openPage })
    await user.click(within(panel()).getByRole('button', { name: /ENG-25/ }))

    const link = within(modal(/^ENG-25/)).getByRole('link', { name: 'Open as page' })
    expect(link.getAttribute('href')).toBe('/ENG/ticket/25')
    await user.click(link)

    expect(openPage).toHaveBeenCalledWith(expect.objectContaining({ id: STATUSES.id }))
  })
})

describe('a linked ticket on another team', () => {
  it('is read against its own team', async () => {
    const { user } = renderPanel()
    await user.click(within(panel()).getByRole('button', { name: /OPS-3/ }))

    expect(
      within(modal(/^OPS-3/)).getByText('Body of OPS-3, read on team OPS'),
    ).toBeTruthy()
  })

  it('says so when that team is not yours', async () => {
    mocks.refused.add(RUNBOOK.id)
    const { user } = renderPanel()
    await user.click(within(panel()).getByRole('button', { name: /OPS-3/ }))

    expect(
      within(modal(/^OPS-3$/)).getByText('OPS-3 is on a team you are not a member of.'),
    ).toBeTruthy()
  })
})

describe('on a ticket’s page', () => {
  function renderPage() {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/ENG/ticket/20']}>
          <TeamProvider value={TEAM}>
            <TicketSurfaceContext.Provider value="page">
              <TicketStack ticket={IMPORT}>
                <main>
                  <FakeBody />
                </main>
              </TicketStack>
            </TicketSurfaceContext.Provider>
            <Where />
          </TeamProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    return userEvent.setup()
  }

  function FakeBody() {
    const related = useRelatedTickets()
    return (
      <button type="button" onClick={(event) => related.open(STATUSES, event.currentTarget)}>
        {STATUSES.identifier}
      </button>
    )
  }

  it('opens a linked ticket in a modal over the page, which Escape closes', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'ENG-25' }))

    expect(modal(/^ENG-25/)).toBeTruthy()
    expect(where().dataset.surface).toBe('page')
    expect(where().textContent).toBe('/ENG/ticket/20')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(where().dataset.modals).toBe('0')
  })

  it('leaves Escape alone with no modal open: the page has nothing to close', async () => {
    const user = renderPage()
    await user.keyboard('{Escape}')
    expect(where().textContent).toBe('/ENG/ticket/20')
  })
})

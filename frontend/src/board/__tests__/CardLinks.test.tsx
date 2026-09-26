// @vitest-environment jsdom
/**
 * A card on the board and a row in the list are links to their issue (#112).
 *
 * A plain click is the app's: the issue in the panel, over the board. The rest
 * of what a link does -- a middle click, "Open in new tab", a modified click
 * with nothing to select -- is left to the browser, which opens the issue's
 * page. And a card carried across the board does not follow its link when it
 * is put down.
 *
 * jsdom has no layout, so each column and card is given a box, as in
 * KanbanKeyboard.test.tsx: enough for dnd-kit to run a real pointer drag.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IssueRead, StatusRead, TeamMemberRead } from '@/api/generated/models'
import { IssueListView } from '@/board/IssueListView'
import { KanbanBoard } from '@/board/KanbanBoard'
import { surfaceFor } from '@/issues/surface'
import { TeamProvider } from '@/team/TeamContext'
import type { TeamContextValue } from '@/team/useTeamContext'

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: { id: 10 } }),
}))

function status(id: number, name: string): StatusRead {
  return { id, team_id: 7, name, category: 'unstarted', position: id, color: '#888' }
}

const TODO = status(1, 'Todo')
const DOING = status(2, 'In Progress')

const TEAM: TeamContextValue = {
  team: { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' },
  teams: [],
  projects: [],
  labels: [],
  members: [],
  cycles: [],
  statuses: [TODO, DOING],
}

// Reads every issue, moves and selects none (#104).
const GUEST: TeamContextValue = {
  ...TEAM,
  members: [
    { user: { id: 10, full_name: 'Carol Client' }, role: 'guest' } as unknown as TeamMemberRead,
  ],
}

const ISSUE = {
  id: 42,
  team_id: 7,
  team_key: 'ENG',
  number: 42,
  identifier: 'ENG-42',
  title: 'Retry storm',
  status: TODO,
  priority: 'no_priority',
  type: 'task',
  rank: 'a0',
  blocked_by_count: 0,
  child_count: 0,
  completed_child_count: 0,
  labels: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as unknown as IssueRead

function box(left: number, top: number, width: number, height: number) {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} } as DOMRect
}

beforeEach(() => {
  // Columns side by side 300px apart, each card stacked down its column.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    const column = this.closest('[data-column]')
    const columns = [...document.querySelectorAll('[data-column]')]
    const left = column ? columns.indexOf(column) * 300 : 0
    if (this.hasAttribute('data-column')) return box(left, 0, 280, 800)
    if (this.hasAttribute('data-card')) {
      const cards = column ? [...column.querySelectorAll('[data-card]')] : [this]
      return box(left + 10, 60 + cards.indexOf(this) * 100, 260, 90)
    }
    return box(0, 0, 1000, 800)
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** Where opening the issue went, and as which surface. */
function Where() {
  const location = useLocation()
  return (
    <output data-testid="where" data-surface={surfaceFor(location.state)}>
      {location.pathname}
    </output>
  )
}

function renderView(view: 'board' | 'list', { guest = false } = {}) {
  // As BoardPage does it: a guest has nothing to select.
  const onSelect = guest ? undefined : vi.fn()
  const onStatusChange = vi.fn()
  const { container } = render(
    <TeamProvider value={guest ? GUEST : TEAM}>
      <MemoryRouter initialEntries={['/ENG']}>
        <Routes>
          <Route
            path="/ENG"
            element={
              view === 'board' ? (
                <KanbanBoard issues={[ISSUE]} onStatusChange={onStatusChange} onSelect={onSelect} />
              ) : (
                <IssueListView issues={[ISSUE]} onSelect={onSelect} />
              )
            }
          />
          <Route path="/ENG/issue/:n" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </TeamProvider>,
  )

  /**
   * Click, and say whether the browser would go on to follow the link: whether
   * the click's default survived the app's handlers. Read at the root React
   * listens on, after them -- and stopped there, since jsdom cannot follow one.
   * A click stopped before it gets that far is read off the event itself.
   */
  const follows = (target: Element, init: MouseEventInit = {}) => {
    let followed: boolean | undefined
    const settle = (event: Event) => {
      followed = !event.defaultPrevented
      event.preventDefault()
    }
    container.addEventListener('click', settle)
    const notPrevented = fireEvent.click(target, init)
    container.removeEventListener('click', settle)
    return followed ?? notPrevented
  }

  return { onSelect, onStatusChange, follows }
}

const where = () => screen.queryByTestId('where')

describe('a card on the board', () => {
  it('is a link to its issue, which a middle click opens in a new tab', () => {
    renderView('board')
    const card = screen.getByRole('link', { name: /ENG-42/ })
    expect(card.getAttribute('href')).toBe('/ENG/issue/42')
    expect(card.getAttribute('data-card')).toBe('42')
  })

  it('opens the panel on a plain click, rather than following the link', () => {
    const { follows } = renderView('board')
    expect(follows(screen.getByRole('link', { name: /ENG-42/ }))).toBe(false)
    expect(where()?.textContent).toBe('/ENG/issue/42')
    expect(where()?.dataset.surface).toBe('panel')
  })

  it('selects on ⌘-click, rather than opening a tab', () => {
    const { follows, onSelect } = renderView('board')
    expect(follows(screen.getByRole('link', { name: /ENG-42/ }), { metaKey: true })).toBe(false)
    expect(onSelect).toHaveBeenCalledWith(42, 'toggle', [42])
    expect(where()).toBeNull()
  })

  it('leaves ⌘-click to the browser for a guest, who has nothing to select', () => {
    const { follows } = renderView('board', { guest: true })
    expect(follows(screen.getByRole('link', { name: /ENG-42/ }), { metaKey: true })).toBe(true)
    expect(where()).toBeNull()
  })
})

describe('a card carried across the board', () => {
  // dnd-kit's own guard outlives the drop by 50ms, on the document, where it
  // would swallow the next test's clicks too.
  afterEach(() => new Promise((resolve) => setTimeout(resolve, 60)))

  it('does not follow its link when it is put down', async () => {
    const { onStatusChange, follows } = renderView('board')
    const card = screen.getByRole('link', { name: /ENG-42/ })

    // Pressed, carried past dnd-kit's 8px into In Progress, and let go there.
    fireEvent.pointerDown(card, { isPrimary: true, button: 0, clientX: 140, clientY: 105 })
    fireEvent.pointerMove(document, { isPrimary: true, clientX: 160, clientY: 105 })
    fireEvent.pointerMove(document, { isPrimary: true, clientX: 440, clientY: 105 })
    fireEvent.pointerUp(document, { isPrimary: true, clientX: 440, clientY: 105 })
    expect(onStatusChange).toHaveBeenCalledWith(42, DOING)

    // The browser ends the drag with a click on the card it carried, which
    // dnd-kit keeps from the card's own handler but not from the link.
    expect(follows(card)).toBe(false)
    expect(where()).toBeNull()

    // A moment later -- once dnd-kit's guard and this one have both let go --
    // a click is a click again, and opens the panel.
    await new Promise((resolve) => setTimeout(resolve, 60))
    fireEvent.click(card)
    expect(where()?.dataset.surface).toBe('panel')
  })
})

describe('a row in the list', () => {
  it('is a link to its issue, and opens the panel on a plain click', () => {
    const { follows } = renderView('list')
    const row = screen.getByRole('link', { name: /ENG-42/ })
    expect(row.getAttribute('href')).toBe('/ENG/issue/42')

    expect(follows(row)).toBe(false)
    expect(where()?.dataset.surface).toBe('panel')
  })

  it('selects on Ctrl-click, rather than opening a tab', () => {
    const { follows, onSelect } = renderView('list')
    expect(follows(screen.getByRole('link', { name: /ENG-42/ }), { ctrlKey: true })).toBe(false)
    expect(onSelect).toHaveBeenCalledWith(42, 'toggle', [42])
    expect(where()).toBeNull()
  })
})

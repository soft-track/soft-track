// @vitest-environment jsdom
/**
 * Moving a card between columns with the keyboard alone (issue #80).
 *
 * jsdom has no layout, so every column and card is given a box: columns
 * side by side 300px apart, each card sitting in its own column. That is all
 * dnd-kit needs to run the real keyboard sensor and collision detection.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IssueRead, StatusRead, TeamMemberRead } from '@/api/generated/models'
import { KanbanBoard } from '@/board/KanbanBoard'
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
const DONE = status(3, 'Done')

const TEAM: TeamContextValue = {
  team: { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' },
  teams: [],
  projects: [],
  labels: [],
  members: [],
  cycles: [],
  statuses: [TODO, DOING, DONE],
}

const ISSUE = {
  id: 42,
  team_id: 7,
  team_key: 'ENG',
  number: 42,
  identifier: 'ENG-42',
  title: 'Keyboard drag',
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
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    const column = this.closest('[data-column]')
    const columns = [...document.querySelectorAll('[data-column]')]
    const left = column ? columns.indexOf(column) * 300 : 0
    if (this.hasAttribute('data-column')) return box(left, 0, 280, 800)
    if (this.hasAttribute('data-card')) {
      // Stacked down the column, one card every 100px.
      const cards = column ? [...column.querySelectorAll('[data-card]')] : [this]
      return box(left + 10, 60 + cards.indexOf(this) * 100, 260, 90)
    }
    return box(0, 0, 1000, 800)
  })
})

afterEach(() => {
  observer?.disconnect()
  cleanup()
  vi.restoreAllMocks()
})

function renderBoard(issues: IssueRead[] = [ISSUE], team: TeamContextValue = TEAM) {
  const onStatusChange = vi.fn()
  const onMove = vi.fn()
  render(
    <TeamProvider value={team}>
      <MemoryRouter initialEntries={['/ENG']}>
        <Routes>
          <Route
            path="/ENG"
            element={
              <KanbanBoard issues={issues} onStatusChange={onStatusChange} onMove={onMove} />
            }
          />
          <Route path="/ENG/issue/:n" element={<p>Opened the issue</p>} />
        </Routes>
      </MemoryRouter>
    </TeamProvider>,
  )
  const card = document.querySelector<HTMLElement>('[data-card="42"]')!
  card.focus()
  listen()
  return { onStatusChange, onMove, user: userEvent.setup() }
}

/**
 * Everything dnd-kit's live region has said so far. It holds only the latest
 * line -- "Picked up" is replaced at once by "is over Todo" -- so each change
 * is recorded as it happens, the way a screen reader would hear it.
 */
let heard: string[] = []
let observer: MutationObserver | undefined
function listen() {
  heard = []
  observer = new MutationObserver(() => {
    for (const region of document.querySelectorAll('[role="status"]')) {
      const text = region.textContent ?? ''
      if (text && heard[heard.length - 1] !== text) heard.push(text)
    }
  })
  observer.observe(document.body, { childList: true, characterData: true, subtree: true })
}
const announced = () => heard.join(' | ')

describe('keyboard drag and drop', () => {
  it('picks up with Space, moves with the arrows, drops with Space', async () => {
    const { onStatusChange, user } = renderBoard()

    await user.keyboard(' ')
    await waitFor(() => expect(announced()).toMatch(/Picked up ENG-42 in Todo/))

    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(announced()).toMatch(/ENG-42 is over In Progress/))

    await user.keyboard(' ')
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith(42, DOING))
    expect(announced()).toMatch(/Moved ENG-42 to In Progress/)
  })

  it('drops with Enter too, without opening the issue', async () => {
    const { onStatusChange, user } = renderBoard()
    await user.keyboard(' ')
    await user.keyboard('{ArrowRight}{ArrowRight}')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith(42, DONE))
    expect(screen.queryByText('Opened the issue')).toBeNull()
  })

  it('puts the card back on Escape', async () => {
    const { onStatusChange, user } = renderBoard()
    await user.keyboard(' ')
    await user.keyboard('{ArrowRight}')
    await user.keyboard('{Escape}')

    await waitFor(() => expect(announced()).toMatch(/Move cancelled\. ENG-42 stays in Todo/))
    expect(onStatusChange).not.toHaveBeenCalled()
  })

  it('still opens the issue on Enter when nothing is picked up', async () => {
    const { user } = renderBoard()
    await user.keyboard('{Enter}')
    expect(screen.getByText('Opened the issue')).toBeTruthy()
  })

  it('moves a card down past the next one in its column with the arrows (#88)', async () => {
    const below = { ...ISSUE, id: 43, number: 43, identifier: 'ENG-43', title: 'Below' }
    const { onMove, onStatusChange, user } = renderBoard([ISSUE, below])

    await user.keyboard(' ')
    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect(announced()).toMatch(/ENG-42 is in Todo, next to ENG-43/))
    await user.keyboard(' ')

    await waitFor(() =>
      expect(onMove).toHaveBeenCalledWith(42, { aboveId: 43, belowId: null }),
    )
    expect(onStatusChange).not.toHaveBeenCalled()
    expect(announced()).toMatch(/Moved ENG-42 within Todo/)
  })

  it('tells a screen reader how, before anything is picked up', () => {
    renderBoard()
    const card = document.querySelector('[data-card="42"]')!
    const describedBy = card.getAttribute('aria-describedby')!
    expect(document.getElementById(describedBy)?.textContent).toMatch(
      /press Space to pick it up/,
    )
  })

  it('does not pick anything up for a guest (#104)', async () => {
    const guest = {
      ...TEAM,
      members: [
        {
          user: { id: 10, full_name: 'Carol Client' },
          role: 'guest',
          joined_at: '2026-01-01T00:00:00Z',
        } as unknown as TeamMemberRead,
      ],
    }
    const { onStatusChange, onMove, user } = renderBoard([ISSUE], guest)

    const card = document.querySelector('[data-card="42"]')!
    // No "sortable" role description and no pick-up instructions: nothing
    // offers a move the server would refuse.
    expect(card.getAttribute('aria-roledescription')).toBeNull()
    expect(card.getAttribute('aria-describedby')).toBeNull()

    await user.keyboard(' ')
    await user.keyboard('{ArrowRight}')
    await user.keyboard(' ')
    expect(announced()).not.toMatch(/Picked up/)
    expect(onStatusChange).not.toHaveBeenCalled()
    expect(onMove).not.toHaveBeenCalled()

    // Opening it still works: a guest reads issues.
    await user.keyboard('{Enter}')
    expect(screen.getByText('Opened the issue')).toBeTruthy()
  })
})

// @vitest-environment jsdom
/**
 * The quick peek (#113): a read-only look at a card, on Space or a mouse
 * resting on it, from what the board already has.
 *
 * The harness wires the real board, list, peek and layer together the way
 * BoardPage does, around a router whose second route says when something
 * opened an issue instead of peeking at it.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { AxiosAdapter } from 'axios'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import { AXIOS_INSTANCE } from '@/api/client'
import type { IssueRead, StatusRead, TeamMemberRead } from '@/api/generated/models'
import { IssueListView } from '@/board/IssueListView'
import { IssuePeekLayer } from '@/board/IssuePeek'
import { KanbanBoard } from '@/board/KanbanBoard'
import { PEEK_DELAY_MS } from '@/board/peek'
import { PeekContext } from '@/board/peekContext'
import { usePeek } from '@/board/usePeek'
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
  projects: [{ id: 3, name: 'Launch', color: '#f59e0b' } as TeamContextValue['projects'][number]],
  labels: [],
  members: [],
  cycles: [],
  statuses: [TODO, DOING],
}

function issue(id: number, fields: Partial<IssueRead> = {}): IssueRead {
  return {
    id,
    team_id: 7,
    team_key: 'ENG',
    number: id,
    identifier: `ENG-${id}`,
    title: `Issue ${id}`,
    status: TODO,
    priority: 'no_priority',
    type: 'task',
    rank: `a${id}`,
    labels: [],
    blocked_by_count: 0,
    child_count: 0,
    completed_child_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...fields,
  } as unknown as IssueRead
}

const STORM = issue(42, {
  title: 'Retry storm after deploy',
  description: '## What happens\n\nThe **queue** backs up.\n\n- [ ] Cap the retries',
  status: DOING,
  priority: 'urgent',
  assignee: { id: 4, full_name: 'Maya Chen', avatar_color: '#123' } as IssueRead['assignee'],
  estimate: 3,
  project_id: 3,
  labels: [{ id: 9, name: 'Backend', color: '#0ea5e9' } as NonNullable<IssueRead['labels']>[number]],
  child_count: 3,
  completed_child_count: 1,
  blocked_by_count: 2,
})
// In the same column as STORM, just under it.
const BELOW = issue(43, { title: 'The one below', status: DOING })

function Harness({
  issues,
  view,
  onPromote,
  onSelect,
}: {
  issues: IssueRead[]
  view: 'board' | 'list'
  onPromote: (issue: IssueRead) => void
  onSelect: () => void
}) {
  const peek = usePeek()
  const peeked = peek.peeked ? issues.find((one) => one.id === peek.peeked?.id) : undefined
  return (
    <>
      <PeekContext.Provider value={peek}>
        {view === 'board' ? (
          <KanbanBoard issues={issues} onStatusChange={vi.fn()} onSelect={onSelect} />
        ) : (
          <IssueListView issues={issues} onSelect={onSelect} />
        )}
      </PeekContext.Provider>
      <IssuePeekLayer peek={peek} issue={peeked} onPromote={onPromote} />
    </>
  )
}

function renderBoard(
  view: 'board' | 'list' = 'board',
  { team = TEAM, issues = [STORM, BELOW] }: { team?: TeamContextValue; issues?: IssueRead[] } = {},
) {
  const onPromote = vi.fn()
  const onSelect = vi.fn()
  const tree = (shown: IssueRead[]) => (
    <TeamProvider value={team}>
      <MemoryRouter initialEntries={['/ENG']}>
        <Routes>
          <Route
            path="/ENG"
            element={
              <Harness issues={shown} view={view} onPromote={onPromote} onSelect={onSelect} />
            }
          />
          <Route path="/ENG/issue/:n" element={<p>Opened the issue</p>} />
        </Routes>
      </MemoryRouter>
    </TeamProvider>
  )
  const { rerender } = render(tree(issues))
  /** The board refetched, and now shows these. */
  const refetched = (shown: IssueRead[]) => rerender(tree(shown))
  return { onPromote, onSelect, refetched }
}

const card = (id: number) => document.querySelector<HTMLElement>(`[data-card="${id}"]`)!
const peekCard = () => screen.queryByRole('tooltip')

let adapter: Mock<AxiosAdapter>

beforeEach(() => {
  // Every request the app makes goes through this adapter; a peek makes none.
  adapter = vi.fn<AxiosAdapter>(() => Promise.reject(new Error('no requests in a peek')))
  AXIOS_INSTANCE.defaults.adapter = adapter
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('peeking with the keyboard', () => {
  it('opens on Space, from what the card already has, and asks the server nothing', async () => {
    const { onSelect } = renderBoard()
    card(42).focus()
    await userEvent.keyboard(' ')

    const peek = peekCard()!
    expect(peek.getAttribute('aria-label')).toBe('Preview of ENG-42')
    const text = peek.textContent ?? ''
    for (const expected of [
      'ENG-42',
      'Retry storm after deploy',
      'In Progress',
      'Maya Chen',
      'Urgent',
      'Launch',
      'Backend',
      '1 of 3 sub-issues done',
      'Blocked by 2 unresolved issues',
    ]) {
      expect(text).toContain(expected)
    }
    // The first lines of the description, without their markdown.
    expect(text).toContain('What happens\nThe queue backs up.\nCap the retries')

    expect(adapter).not.toHaveBeenCalled()
    // Focus and the selection stay where they were: a peek moves nothing.
    expect(document.activeElement).toBe(card(42))
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.queryByText('Opened the issue')).toBeNull()
  })

  it('tells a screen reader what it is showing, since focus stays on the card', async () => {
    renderBoard()
    card(42).focus()
    await userEvent.keyboard(' ')
    const region = document.querySelector('[aria-live="polite"]')
    expect(region?.textContent).toBe(
      'Preview of ENG-42, Retry storm after deploy. In Progress. Enter opens it, Escape closes it.',
    )
  })

  it('closes on Space again, and on Escape without reaching the board', async () => {
    renderBoard()
    card(42).focus()
    await userEvent.keyboard(' ')
    await userEvent.keyboard(' ')
    expect(peekCard()).toBeNull()

    await userEvent.keyboard(' ')
    const boardHeard = vi.fn()
    window.addEventListener('keydown', boardHeard)
    await userEvent.keyboard('{Escape}')
    window.removeEventListener('keydown', boardHeard)

    expect(peekCard()).toBeNull()
    // The board's own Escape -- clearing a selection, closing an overlay --
    // never hears it.
    expect(boardHeard).not.toHaveBeenCalled()
  })

  it('opens the issue as a page on Enter, not in the panel', async () => {
    const { onPromote } = renderBoard()
    card(42).focus()
    await userEvent.keyboard(' ')
    await userEvent.keyboard('{Enter}')

    expect(onPromote).toHaveBeenCalledWith(STORM)
    expect(peekCard()).toBeNull()
    expect(screen.queryByText('Opened the issue')).toBeNull()
  })

  it('follows the focus from card to card', async () => {
    renderBoard()
    card(42).focus()
    await userEvent.keyboard(' ')
    await userEvent.keyboard('{ArrowDown}')

    expect(document.activeElement).toBe(card(43))
    expect(peekCard()?.getAttribute('aria-label')).toBe('Preview of ENG-43')
  })

  it('ends when the card is picked up to be moved', async () => {
    renderBoard()
    card(42).focus()
    await userEvent.keyboard(' ')
    await userEvent.keyboard('{Shift>} {/Shift}')
    expect(peekCard()).toBeNull()
  })

  it('peeks at a list row, without opening it', async () => {
    renderBoard('list')
    const row = screen.getByRole('link', { name: /ENG-42/ })
    row.focus()
    await userEvent.keyboard(' ')

    expect(peekCard()?.getAttribute('aria-label')).toBe('Preview of ENG-42')
    expect(screen.queryByText('Opened the issue')).toBeNull()
  })

  it('works for a guest (#104), who reads issues but moves none', async () => {
    const guest = {
      ...TEAM,
      members: [
        { user: { id: 10, full_name: 'Carol Client' }, role: 'guest' } as unknown as TeamMemberRead,
      ],
    }
    renderBoard('board', { team: guest })
    card(42).focus()
    await userEvent.keyboard(' ')
    expect(peekCard()).not.toBeNull()
  })

  it('keeps up with the board, and goes when its card leaves it', async () => {
    const { refetched } = renderBoard()
    card(42).focus()
    await userEvent.keyboard(' ')

    // Somebody renamed it: the peek reads the board's copy, not a snapshot.
    refetched([{ ...STORM, title: 'Retry storm, capped' }, BELOW])
    expect(peekCard()?.textContent).toContain('Retry storm, capped')

    // And now it is filtered out, or moved away.
    refetched([BELOW])
    expect(peekCard()).toBeNull()
  })
})

/**
 * A mouse arriving on and leaving a card. `fireEvent` rather than
 * user-event, which awaits a real timer between steps -- and the clock here
 * is fake, so that the delay can be stepped through a millisecond at a time.
 */
const mouseOnto = (target: HTMLElement) => fireEvent.pointerEnter(target, { pointerType: 'mouse' })
const mouseOff = (target: HTMLElement) =>
  fireEvent.pointerLeave(target, { pointerType: 'mouse', relatedTarget: document.body })

describe('peeking with the mouse', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('opens once the pointer has rested for the delay, and not before', () => {
    renderBoard()

    mouseOnto(card(42))
    act(() => vi.advanceTimersByTime(PEEK_DELAY_MS - 1))
    expect(peekCard()).toBeNull()

    act(() => vi.advanceTimersByTime(1))
    expect(peekCard()?.getAttribute('aria-label')).toBe('Preview of ENG-42')
    expect(adapter).not.toHaveBeenCalled()

    mouseOff(card(42))
    expect(peekCard()).toBeNull()
  })

  it('never opens for a pointer only passing over', () => {
    renderBoard()

    mouseOnto(card(42))
    act(() => vi.advanceTimersByTime(PEEK_DELAY_MS / 2))
    mouseOff(card(42))
    act(() => vi.advanceTimersByTime(PEEK_DELAY_MS))
    expect(peekCard()).toBeNull()
  })

  it('gives touch nothing: there is no hover to rest with', () => {
    renderBoard()
    fireEvent.pointerEnter(card(42), { pointerType: 'touch' })
    act(() => vi.advanceTimersByTime(PEEK_DELAY_MS * 2))
    expect(peekCard()).toBeNull()
  })

  it('ignores a pointer carrying something across the board', () => {
    renderBoard()
    fireEvent.pointerEnter(card(42), { pointerType: 'mouse', buttons: 1 })
    act(() => vi.advanceTimersByTime(PEEK_DELAY_MS * 2))
    expect(peekCard()).toBeNull()
  })

  it('closes on a press, which is the start of a click or a drag', () => {
    renderBoard()
    mouseOnto(card(42))
    act(() => vi.advanceTimersByTime(PEEK_DELAY_MS))
    expect(peekCard()).not.toBeNull()

    fireEvent.pointerDown(card(42), { pointerType: 'mouse' })
    expect(peekCard()).toBeNull()
  })

  it('leaves a peek opened from the keyboard alone when the mouse moves off', () => {
    renderBoard()
    card(42).focus()
    fireEvent.keyDown(card(42), { key: ' ', code: 'Space' })
    expect(peekCard()).not.toBeNull()

    mouseOnto(card(42))
    mouseOff(card(42))
    expect(peekCard()).not.toBeNull()
  })
})

// @vitest-environment jsdom
/**
 * The command palette, from the keystroke that opens it to the one that runs
 * something.
 *
 * ⌘K is not the palette's own key: BoardPage's useGlobalShortcuts toggles it
 * from the window, and the palette is only mounted while open. The harness
 * mirrors that wiring, so "opens on ⌘K" is tested as the user experiences it.
 *
 * It uses the board's real overlay stack for the same reason. Escape is the
 * one key two layers can both hear, and a harness holding a single boolean
 * cannot tell "closed the palette" apart from "closed the palette and
 * whatever was behind it".
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IssueRead } from '@/api/generated/models'
import { useOverlays } from '@/board/useOverlays'
import { CommandPalette, type Command } from '@/keyboard/CommandPalette'
import { useGlobalShortcuts } from '@/keyboard/useGlobalShortcuts'

const run = { create: vi.fn(), shortcuts: vi.fn(), theme: vi.fn() }

const COMMANDS: Command[] = [
  { id: 'new-issue', label: 'Create issue', hint: 'C', group: 'Actions', run: run.create },
  { id: 'shortcuts', label: 'Show keyboard shortcuts', hint: '?', group: 'Actions', run: run.shortcuts },
  { id: 'theme', label: 'Toggle theme', group: 'Actions', run: run.theme },
]

const ADA = {
  id: 10,
  email: 'ada@example.com',
  username: 'ada',
  full_name: 'Ada Lovelace',
  avatar_color: '#123',
  is_active: true,
}

const ISSUE: IssueRead = {
  id: 1,
  team_id: 7,
  team_key: 'ENG',
  number: 1,
  identifier: 'ENG-1',
  title: 'Fix login',
  status: { id: 1, team_id: 7, name: 'Todo', category: 'unstarted', position: 0, color: '#888' },
  priority: 'no_priority',
    type: 'task',
    rank: 'a0',
  blocked_by_count: 0,
  child_count: 0,
  completed_child_count: 0,
  creator: ADA,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function Harness({ onOpenIssue }: { onOpenIssue: (issue: IssueRead) => void }) {
  const overlays = useOverlays()
  const open = overlays.isOpen('palette')
  useGlobalShortcuts({
    togglePalette: () => overlays.toggle('palette'),
    closeTop: overlays.closeTop,
    openNewIssue: () => overlays.open('newIssue'),
    openShortcuts: () => {},
    suppressed: open,
  })
  return (
    <>
      {/* Stands in for the layers the board can have open underneath -- the
          issue detail panel, the new-issue modal. Only its presence matters. */}
      {overlays.isOpen('newIssue') && <div role="dialog" aria-label="Layer underneath" />}
      {open && (
        <CommandPalette
          onClose={() => overlays.close('palette')}
          commands={COMMANDS}
          issues={[ISSUE]}
          onOpenIssue={onOpenIssue}
        />
      )}
    </>
  )
}

function renderPalette() {
  const onOpenIssue = vi.fn()
  render(<Harness onOpenIssue={onOpenIssue} />)
  return { onOpenIssue, user: userEvent.setup() }
}

const dialog = () => screen.queryByRole('dialog', { name: 'Command palette' })
// The first span in a row is its label; the second, when there is one, is the
// hint. Reading the label alone keeps these assertions short.
const labelOf = (option: Element) => option.firstElementChild?.textContent
const labels = () => screen.getAllByRole('option').map(labelOf)
const highlighted = () => labelOf(screen.getByRole('option', { selected: true }))

beforeAll(() => {
  // jsdom does not lay anything out, and the palette scrolls the highlight into view.
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  for (const fn of Object.values(run)) fn.mockReset()
})

// The suite runs without globals, so Testing Library cannot register this itself.
afterEach(cleanup)

describe('CommandPalette', () => {
  it('opens on ⌘K with the search field focused, and ⌘K again closes it', async () => {
    const { user } = renderPalette()
    expect(dialog()).toBeNull()

    await user.keyboard('{Meta>}k{/Meta}')
    expect(dialog()).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Command' }))

    await user.keyboard('{Meta>}k{/Meta}')
    expect(dialog()).toBeNull()
  })

  it('lists every command and the issues until you type, then filters both', async () => {
    const { user } = renderPalette()
    await user.keyboard('{Meta>}k{/Meta}')
    expect(labels()).toEqual(['Create issue', 'Show keyboard shortcuts', 'Toggle theme', 'Fix login'])

    await user.keyboard('theme')
    expect(labels()).toEqual(['Toggle theme'])

    await user.clear(screen.getByRole('textbox', { name: 'Command' }))
    await user.keyboard('eng-1')
    expect(labels()).toEqual(['Fix login'])

    await user.keyboard('zzz')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('Nothing matches “eng-1zzz”.')).toBeTruthy()
  })

  it('runs the highlighted command on Enter and closes', async () => {
    const { user } = renderPalette()
    await user.keyboard('{Meta>}k{/Meta}{Enter}')

    expect(run.create).toHaveBeenCalledTimes(1)
    expect(run.shortcuts).not.toHaveBeenCalled()
    expect(dialog()).toBeNull()
  })

  it('opens a highlighted issue on Enter', async () => {
    const { onOpenIssue, user } = renderPalette()
    await user.keyboard('{Meta>}k{/Meta}fix{Enter}')

    expect(onOpenIssue).toHaveBeenCalledWith(ISSUE)
    expect(dialog()).toBeNull()
  })

  it('closes on Escape without running anything', async () => {
    const { onOpenIssue, user } = renderPalette()
    await user.keyboard('{Meta>}k{/Meta}{Escape}')

    expect(dialog()).toBeNull()
    for (const fn of Object.values(run)) expect(fn).not.toHaveBeenCalled()
    expect(onOpenIssue).not.toHaveBeenCalled()
  })

  it('runs the result you click, and highlights the one under the pointer', async () => {
    const { onOpenIssue, user } = renderPalette()
    await user.keyboard('{Meta>}k{/Meta}')

    await user.hover(screen.getByRole('option', { name: /Fix login/ }))
    expect(highlighted()).toBe('Fix login')

    await user.click(screen.getByRole('option', { name: /Toggle theme/ }))
    expect(run.theme).toHaveBeenCalledTimes(1)
    expect(onOpenIssue).not.toHaveBeenCalled()
    expect(dialog()).toBeNull()
  })

  it('keeps the highlight on the list when the query shrinks it', async () => {
    const { user } = renderPalette()
    await user.keyboard('{Meta>}k{/Meta}{ArrowUp}')
    expect(highlighted()).toBe('Fix login')

    // The highlight is now past the end of what is left. Enter has to run the
    // row the user can actually see, not fall off the list and do nothing.
    await user.keyboard('theme')
    expect(labels()).toEqual(['Toggle theme'])
    expect(highlighted()).toBe('Toggle theme')

    await user.keyboard('{Enter}')
    expect(run.theme).toHaveBeenCalledTimes(1)
    expect(dialog()).toBeNull()
  })

  it('closes only itself on Escape, leaving the layer underneath open', async () => {
    const { user } = renderPalette()

    await user.keyboard('c')
    expect(screen.getByRole('dialog', { name: 'Layer underneath' })).toBeTruthy()
    await user.keyboard('{Meta>}k{/Meta}')
    expect(dialog()).toBeTruthy()

    // One Escape, one layer: the palette stops the key reaching the window,
    // so closeTop does not pop the thing behind it in the same keystroke.
    await user.keyboard('{Escape}')
    expect(dialog()).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Layer underneath' })).toBeTruthy()

    // And with the palette gone, Escape reaches the window again.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Layer underneath' })).toBeNull()
  })

  it('moves the highlight with the arrow keys, wrapping at both ends', async () => {
    const { user } = renderPalette()
    await user.keyboard('{Meta>}k{/Meta}')
    expect(highlighted()).toBe('Create issue')

    await user.keyboard('{ArrowDown}')
    expect(highlighted()).toBe('Show keyboard shortcuts')

    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(highlighted()).toBe('Fix login')

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(run.shortcuts).toHaveBeenCalledTimes(1)
    expect(run.create).not.toHaveBeenCalled()
  })
})

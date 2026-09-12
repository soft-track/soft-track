// @vitest-environment jsdom
/**
 * The command palette, from the keystroke that opens it to the one that runs
 * something.
 *
 * ⌘K is not the palette's own key: BoardPage's useGlobalShortcuts toggles it
 * from the window, and the palette is only mounted while open. The harness
 * mirrors that wiring, so "opens on ⌘K" is tested as the user experiences it.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IssueRead } from '@/api/generated/models'
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
  blocked_by_count: 0,
  child_count: 0,
  completed_child_count: 0,
  creator: ADA,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function Harness({ onOpenIssue }: { onOpenIssue: (issue: IssueRead) => void }) {
  const [open, setOpen] = useState(false)
  useGlobalShortcuts({
    togglePalette: () => setOpen((o) => !o),
    closeTop: () => setOpen(false),
    openNewIssue: () => {},
    openShortcuts: () => {},
    suppressed: open,
  })
  return open ? (
    <CommandPalette
      onClose={() => setOpen(false)}
      commands={COMMANDS}
      issues={[ISSUE]}
      onOpenIssue={onOpenIssue}
    />
  ) : null
}

function renderPalette() {
  const onOpenIssue = vi.fn()
  render(<Harness onOpenIssue={onOpenIssue} />)
  return { onOpenIssue, user: userEvent.setup() }
}

const dialog = () => screen.queryByRole('dialog', { name: 'Command palette' })
const labels = () => screen.getAllByRole('option').map((o) => o.firstElementChild?.textContent)
const highlighted = () => screen.getByRole('option', { selected: true }).firstElementChild?.textContent

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

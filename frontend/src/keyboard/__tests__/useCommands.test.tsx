// @vitest-environment jsdom
/**
 * What the command palette offers from the board. Creating anything is left
 * out for a guest (#104), the same as the buttons that do it.
 */
import { cleanup, renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useCommands } from '@/keyboard/useCommands'

function commandIds(creators: { openNewTicket?: () => void; openNewProject?: () => void }) {
  const { result } = renderHook(
    () =>
      useCommands({
        view: 'board',
        setView: () => {},
        team: undefined,
        teams: [],
        user: null,
        openShortcuts: () => {},
        ...creators,
      }),
    { wrapper: MemoryRouter },
  )
  return result.current.map((command) => command.id)
}

afterEach(cleanup)

describe('useCommands', () => {
  it('offers creating a ticket and a project to someone who can write', () => {
    const ids = commandIds({ openNewTicket: vi.fn(), openNewProject: vi.fn() })
    expect(ids.slice(0, 2)).toEqual(['new-ticket', 'new-project'])
  })

  it('offers a guest neither', () => {
    const ids = commandIds({})
    expect(ids).not.toContain('new-ticket')
    expect(ids).not.toContain('new-project')
  })
})

describe('useCommands and My work (#258)', () => {
  it('offers going to My work from the board', () => {
    expect(commandIds({})).toContain('my-work')
  })

  it('offers neither My work nor switching views on My work itself', () => {
    const { result } = renderHook(
      () => useCommands({ team: undefined, teams: [], user: null, openShortcuts: () => {} }),
      { wrapper: MemoryRouter },
    )
    const ids = result.current.map((command) => command.id)
    expect(ids).not.toContain('my-work')
    expect(ids).not.toContain('toggle-view')
  })
})

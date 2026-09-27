// @vitest-environment jsdom
/**
 * What the command palette offers from the board. Creating anything is left
 * out for a guest (#104), the same as the buttons that do it.
 */
import { cleanup, renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useCommands } from '@/keyboard/useCommands'

function commandIds(creators: { openNewIssue?: () => void; openNewProject?: () => void }) {
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
  it('offers creating an issue and a project to someone who can write', () => {
    const ids = commandIds({ openNewIssue: vi.fn(), openNewProject: vi.fn() })
    expect(ids.slice(0, 2)).toEqual(['new-issue', 'new-project'])
  })

  it('offers a guest neither', () => {
    const ids = commandIds({})
    expect(ids).not.toContain('new-issue')
    expect(ids).not.toContain('new-project')
  })
})

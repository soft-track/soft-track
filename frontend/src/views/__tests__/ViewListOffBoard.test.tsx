// @vitest-environment jsdom
/**
 * The saved views beside a page that is not the board (#125): nothing is
 * "showing", however empty its filters are.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NO_FILTERS } from '@/board/filters'
import { DEFAULT_SORT } from '@/board/sorting'
import { TeamProvider, type TeamContextValue } from '@/team/TeamContext'
import { ViewList } from '@/views/ViewList'

const EVERYTHING = {
  id: 7,
  name: 'Everything',
  is_shared: true,
  filters: {},
  group_by: 'status',
  sort: null,
  sort_direction: null,
  owner: { id: 1, full_name: 'Ada', username: 'ada' },
}

vi.mock('@/views/useSavedViews', () => ({
  useSavedViews: () => ({
    views: [EVERYTHING],
    isLoading: false,
    teamDefaultId: null,
    myDefaultId: null,
    effectiveDefaultId: null,
  }),
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: { id: 1 } }),
}))

function renderList(filters: typeof NO_FILTERS | null) {
  render(
    <TeamProvider value={{ team: { id: 1, key: 'ENG' } } as unknown as TeamContextValue}>
      <ViewList
        filters={filters}
        arrangement={{ grouping: 'status', sort: DEFAULT_SORT }}
        onApply={vi.fn()}
        isAdmin={false}
      />
    </TeamProvider>,
  )
}

afterEach(() => {
  cleanup()
})

describe('Saved views off the board', () => {
  it('on the board, an unfiltered board is "All tickets" and the empty view', () => {
    renderList(NO_FILTERS)
    expect(screen.getByRole('button', { name: /All tickets/ }).dataset.active).toBe('true')
    expect(screen.getByRole('button', { name: 'Everything' }).dataset.active).toBe('true')
  })

  it('off the board, neither is showing', () => {
    renderList(null)
    expect(screen.getByRole('button', { name: /All tickets/ }).dataset.active).toBe('false')
    expect(screen.getByRole('button', { name: 'Everything' }).dataset.active).toBe('false')
  })
})

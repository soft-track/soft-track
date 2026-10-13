// @vitest-environment jsdom
/**
 * An archived team's board (#322, frame 3): since when it is read-only, and
 * Unarchive for whoever may.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TeamRead } from '@/api/generated/models'
import { ArchivedBanner } from '@/team/ArchivedBanner'

const update = vi.hoisted(() => vi.fn())

vi.mock('@/api/generated/endpoints/teams/teams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/teams/teams')>()),
  useUpdateTeamTeamsTeamIdPatch: () => ({ mutateAsync: update, isPending: false }),
}))

const TEAM = {
  id: 7,
  name: 'Engineering',
  key: 'ENG',
  created_at: '2026-01-01T00:00:00Z',
  archived_at: '2026-09-30T10:00:00Z',
  archived: true,
} as TeamRead

function renderBanner(props: { mayUnarchive: boolean; compact?: boolean }) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ArchivedBanner team={TEAM} {...props} />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

afterEach(() => {
  cleanup()
  update.mockReset()
})

describe('ArchivedBanner', () => {
  it('says since when, in the mockup’s words', () => {
    renderBanner({ mayUnarchive: false })
    expect(screen.getByRole('status').textContent).toBe(
      'Engineering is archived. Read-only since 30 Sep 2026.',
    )
    expect(screen.queryByRole('button', { name: 'Unarchive' })).toBeNull()
  })

  it('unarchives, for whoever may', async () => {
    update.mockResolvedValue({})
    const user = renderBanner({ mayUnarchive: true })
    await user.click(screen.getByRole('button', { name: 'Unarchive' }))
    expect(update).toHaveBeenCalledWith({ teamId: 7, data: { archived: false } })
  })

  it('offers no button on a ticket', () => {
    renderBanner({ mayUnarchive: true, compact: true })
    expect(screen.queryByRole('button')).toBeNull()
  })
})

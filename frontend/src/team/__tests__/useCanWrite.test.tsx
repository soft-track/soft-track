// @vitest-environment jsdom
/**
 * Nobody writes on an archived team (#322): the board, the ticket and the
 * conversation all ask `useCanWrite`, which says no for the team's admins too.
 */
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { TeamMemberRead, TeamRead } from '@/api/generated/models'
import { TeamProvider } from '@/team/TeamContext'
import { useCanWrite } from '@/team/useCanWrite'

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: { id: 1 } }),
}))

const ADMIN = { user: { id: 1 }, role: 'admin' } as unknown as TeamMemberRead

function wrapper(archivedAt: string | null) {
  const team = { id: 7, key: 'ENG', name: 'Engineering', archived_at: archivedAt } as TeamRead
  return ({ children }: { children: ReactNode }) => (
    <TeamProvider
      value={{
        team,
        teams: [team],
        projects: [],
        labels: [],
        members: [ADMIN],
        sprints: [],
        statuses: [],
      }}
    >
      {children}
    </TeamProvider>
  )
}

describe('useCanWrite', () => {
  it('lets an admin write on a team in use', () => {
    expect(renderHook(useCanWrite, { wrapper: wrapper(null) }).result.current).toBe(true)
  })

  it('does not on an archived team', () => {
    expect(
      renderHook(useCanWrite, { wrapper: wrapper('2026-09-30T10:00:00Z') }).result.current,
    ).toBe(false)
  })
})

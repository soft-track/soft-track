import { describe, expect, it } from 'vitest'

import type { TeamMemberRead, TeamRole } from '@/api/generated/models'
import { canWriteIn } from '@/team/members'

function member(id: number, role: TeamRole): TeamMemberRead {
  return { user: { id }, role, joined_at: '2026-01-01T00:00:00Z' } as unknown as TeamMemberRead
}

describe('canWriteIn (#104)', () => {
  const roster = [member(1, 'admin'), member(2, 'member'), member(3, 'guest')]

  it('lets admins and members write, and not guests', () => {
    expect(canWriteIn(roster, 1)).toBe(true)
    expect(canWriteIn(roster, 2)).toBe(true)
    expect(canWriteIn(roster, 3)).toBe(false)
  })

  it('does not hide the controls while the roster is still loading', () => {
    // The server is the boundary; an empty roster is a query in flight, and
    // hiding a member's board from them for it would be the worse mistake.
    expect(canWriteIn([], 2)).toBe(true)
    expect(canWriteIn(roster, undefined)).toBe(true)
  })
})

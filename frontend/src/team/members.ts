import type { TeamMemberRead, UserPublic } from '@/api/generated/models'

/**
 * The people a picker should offer.
 *
 * Deactivated accounts keep their memberships -- their issues, comments and
 * history all still point at them -- but nobody should be able to assign new
 * work to someone who cannot sign in. `keepId` makes the exception that
 * matters: an issue already assigned to a deactivated colleague has to keep
 * showing them in its own dropdown, or opening the issue would silently offer
 * to unassign it.
 */
export function activeMembers(
  members: TeamMemberRead[],
  keepId?: number | null,
): UserPublic[] {
  return members
    .map((member) => member.user)
    .filter((user) => user.is_active || user.id === keepId)
}

/**
 * Whether someone may change anything on this team (#104).
 *
 * Only a guest may not. Someone missing from the roster -- still loading, or
 * a test that never listed them -- counts as able to: this decides what the
 * UI offers, and the server refuses a guest whatever the UI shows, so the
 * cheap mistake is offering a button that will 403, not hiding the board's
 * controls from its own members while a query is in flight.
 */
export function canWriteIn(members: TeamMemberRead[], userId: number | undefined): boolean {
  return members.find((member) => member.user.id === userId)?.role !== 'guest'
}

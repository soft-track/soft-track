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

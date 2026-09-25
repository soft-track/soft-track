import type { TeamRole } from '@/api/generated/models'

export const ROLE_LABELS: Record<TeamRole, string> = {
  admin: 'Admin',
  member: 'Member',
  guest: 'Guest',
}

/** What each role may do, for the places a role is being chosen. */
export const ROLE_HINTS: Record<TeamRole, string> = {
  admin: 'Can change anything, including who is on the team',
  member: 'Can create and edit issues, comments and cycles',
  guest: 'Can see everything on the team and change nothing',
}

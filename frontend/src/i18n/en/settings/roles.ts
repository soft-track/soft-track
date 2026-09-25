/** Settings → Team → Members: team roles, and the badge on a deactivated account. */
export const roles = {
  labels: {
    admin: 'Admin',
    member: 'Member',
    guest: 'Guest',
  },
  hints: {
    admin: 'Can change anything, including who is on the team',
    member: 'Can create and edit issues, comments and cycles',
    guest: 'Can see everything on the team and change nothing',
  },
  deactivated: 'Deactivated',
} as const

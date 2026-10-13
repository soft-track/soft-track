/** A finance page opened without finance access (#130). */
export const gate = {
  title: 'Finance is for finance admins',
  body: 'A site admin can grant access from Administration → Users.',
  /** For a site admin, who can grant it and may not know they lack it. */
  bodySiteAdmin:
    'Being a site admin does not include it, but you can grant it to anyone, yourself included, from <users>Administration → Users</users>.',
  followed: 'You are seeing this because you followed a link to {{path}}.',
} as const

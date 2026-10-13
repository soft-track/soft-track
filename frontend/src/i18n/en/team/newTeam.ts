/** The new-team page, where an account with no team starts. */
export const newTeam = {
  welcome: 'Welcome, <highlight>{{name}}</highlight>',
  title: 'Create a team',
  intro: 'Teams group your epics and tickets, e.g. "Engineering" with key ENG.',
  nameLabel: 'Team name',
  namePlaceholder: 'Engineering',
  keyLabel: 'Key <hint>· 2 to 6 letters, the ticket prefix</hint>',
  keyPlaceholder: 'ENG',
  create: 'Create team',
  creating: 'Creating…',
  signOut: 'Sign out',
  error: 'Could not create the team.',
  // A key that stays taken (#322), said under the Key field.
  keyArchived: '{{key}} belongs to an archived team, and a key is never given back.',
  keyRetired: '{{key}} was used by a deleted team, and a key is never given back.',
} as const

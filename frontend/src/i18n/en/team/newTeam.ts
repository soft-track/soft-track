/** The new-team page, where an account with no team starts. */
export const newTeam = {
  welcome: 'Welcome, <highlight>{{name}}</highlight>',
  title: 'Create a team',
  intro: 'Teams group your projects and issues, e.g. "Engineering" with key ENG.',
  nameLabel: 'Team name',
  namePlaceholder: 'Engineering',
  keyLabel: 'Key <hint>· 2 to 6 letters, the issue prefix</hint>',
  keyPlaceholder: 'ENG',
  create: 'Create team',
  creating: 'Creating…',
  signOut: 'Sign out',
  error: 'Could not create the team.',
} as const

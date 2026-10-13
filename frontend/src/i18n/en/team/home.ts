/** The teams home, for a signed-in account on no team (#318). */
export const home = {
  welcome: 'Welcome, <highlight>{{name}}</highlight>',
  intro: 'You are not on a team yet. Here is what you can reach in the meantime.',
  introInvited: 'You have been invited to a team. Accept to start, or look around first.',
  // Everything the sidebar would have offered, without a board to hang it on.
  tiles: {
    people: 'People',
    peopleBody: 'Find the people you will be working with.',
    profile: 'Your profile',
    profileBody: 'Add your job title and where you work from.',
    expenses: 'Your expenses',
    expensesBody: 'Claim back what you spent for work.',
    finance: 'Finance',
    financeBody: 'Compensation, payroll runs, claims and budgets.',
  },
  teams: {
    heading: 'Teams you can ask to join',
    // Somebody from outside the organisation (#317), who sees no directory.
    headingOutside: 'Your team',
    outside:
      'Your account is from outside the organisation. Whoever invited you adds you to the team you work with, and it opens from here.',
    hint: 'Ask to join one and its admins decide. Seeing a team’s work takes membership.',
    loading: 'Loading teams…',
    empty: 'There are no teams on this SoftTrack yet.',
  },
  startSomething: 'Starting something new?',
  create: 'Create a team',
  createFirst: 'Create the first team',
  signOut: 'Sign out',
} as const

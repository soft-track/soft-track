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
    hint: 'Ask one of a team’s admins to add you.',
    loading: 'Loading teams…',
    empty: 'There are no teams on this SoftTrack yet.',
    // "8 people · admins Amina Khan and Demo User"
    meta: '{{size}} · {{admins}}',
    size_one: '{{count}} person',
    size_other: '{{count}} people',
    admins_one: 'admin {{names}}',
    admins_other: 'admins {{names}}',
    noAdmin: 'no active admin',
  },
  startSomething: 'Starting something new?',
  create: 'Create a team',
  createFirst: 'Create the first team',
  signOut: 'Sign out',
} as const

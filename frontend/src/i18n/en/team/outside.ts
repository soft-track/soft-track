/**
 * What somebody from outside the organisation is told where the rest of the
 * instance would be (#317): a page, not a redirect, so whoever follows a link
 * learns why there is nothing here.
 */
export const outside = {
  title: {
    people: 'People is for members of the organisation',
    expenses: 'Expense claims are for members of the organisation',
    newTeam: 'Teams are started by members of the organisation',
  },
  guestOf: 'Your account is a guest of {{teams}}.',
  noTeam: 'Your account is from outside the organisation, and not on a team yet.',
  namedThere: 'The people on the tickets you can see are named there.',
  followed: 'You followed a link to <code>{{path}}</code>.',
  back: 'Back to the board',
} as const

/** Asking for a team, where creating one is left to some (#306). */
export const askForTeam = {
  // The card on the page for somebody with no team, and on /new-team.
  card: {
    titleSiteAdmins: 'Teams are created by site admins here',
    titleNamedPeople: 'Teams are created by site admins and a few named people here',
    ask: 'Ask {{names}}, or ask for a team of your own.',
    askNobody: 'Ask for a team of your own.',
    button: 'Ask for a team',
    // Their own requests, waiting.
    pending: 'You asked for <strong>{{name}}</strong> · {{key}}. A site admin will approve or decline it.',
  },
  dialog: {
    title: 'Ask for a team',
    name: 'Name',
    namePlaceholder: 'Brand studio',
    key: 'Key',
    keyPlaceholder: 'BRD',
    reason: 'What it is for',
    reasonPlaceholder: 'The rebrand needs its own board until March.',
    note: 'The site admins are notified. You become the team’s admin when one of them approves.',
    ask: 'Ask',
    asking: 'Asking…',
    error: 'Could not send the request.',
  },
} as const

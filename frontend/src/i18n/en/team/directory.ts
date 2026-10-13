/** Finding a team and asking to join it (#259): /teams, and its rows on the
 * page for somebody on no team (#318). */
export const directory = {
  title: 'Teams',
  intro:
    'The teams on this SoftTrack. Seeing a team’s work takes membership; asking is how you get it.',
  search: 'Search teams',
  backToBoard: 'Back to board',
  loading: 'Loading teams…',
  empty: 'There are no teams on this SoftTrack yet.',
  noMatch: 'No team matches “{{query}}”.',
  unlisted_one: '{{count}} team keeps itself off this list.',
  unlisted_other: '{{count}} teams keep themselves off this list.',
  // "8 people · admins Amina Khan, Demo User"
  meta: '{{size}} · {{admins}}',
  size_one: '{{count}} person',
  size_other: '{{count}} people',
  admins_one: 'admin {{names}}',
  admins_other: 'admins {{names}}',
  noAdmin: 'no active admin',
  // Where you stand with a team.
  askToJoin: 'Ask to join',
  join: 'Join',
  joining: 'Joining…',
  asked: 'Asked {{when}}',
  withdraw: 'Withdraw',
  open: 'Open',
  onIt: 'You are on this team',
  errors: {
    join: 'Could not join this team.',
    withdraw: 'Could not withdraw the request.',
  },
  // The request, with a note.
  dialog: {
    title: 'Ask to join {{team}}',
    notified_one: '{{names}} administers this team and will be notified.',
    notified_other: '{{names}} administer this team and will be notified.',
    nobody: 'This team has no active admin to decide. Ask a site admin instead.',
    note: 'A note',
    optional: '· optional',
    notePlaceholder: 'Who told you to join, or what you will work on',
    send: 'Send request',
    sending: 'Sending…',
    error: 'Could not send the request.',
  },
} as const

/** Projects → the dialog that files existing issues into a project, found by search. */
export const add = {
  title: 'Add tickets to {{project}}',
  intro:
    'A ticket belongs to one epic at a time, so adding one that is already in another epic moves it here.',
  searchLabel: 'Search tickets',
  searchPlaceholder: 'Search tickets on this team…',
  prompt: 'Search by title, description or comment.',
  searching: 'Searching…',
  noMatches: 'No tickets match.',
  alreadyHere: 'Already here',
  submitNone: 'Add tickets',
  submit_one: 'Add {{count}} ticket',
  submit_other: 'Add {{count}} tickets',
  errors: {
    add: 'Could not add those tickets.',
  },
} as const

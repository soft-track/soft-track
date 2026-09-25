/** Projects → the dialog that files existing issues into a project, found by search. */
export const add = {
  title: 'Add issues to {{project}}',
  intro:
    'An issue belongs to one project at a time, so adding one that is already in another project moves it here.',
  searchLabel: 'Search issues',
  searchPlaceholder: 'Search issues on this team…',
  prompt: 'Search by title, description or comment.',
  searching: 'Searching…',
  noMatches: 'No issues match.',
  alreadyHere: 'Already here',
  submitNone: 'Add issues',
  submit_one: 'Add {{count}} issue',
  submit_other: 'Add {{count}} issues',
  errors: {
    add: 'Could not add those issues.',
  },
} as const

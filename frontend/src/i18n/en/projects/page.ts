/** Projects → a project's own page: its header, its fields, and its issues by column. */
export const page = {
  loading: 'Loading epic…',
  notFound: 'This epic does not exist on {{team}}. It may have been deleted.',
  backToBoard: 'Back to the board',
  archived: 'Archived',
  onTheBoard: 'On the board',
  addIssues: 'Add tickets',
  nothingYet: 'Nothing in this epic yet',
  progress: 'Progress',
  progressNote: 'Cancelled tickets count towards neither number.',
  state: 'State',
  lead: 'Lead',
  noLead: 'No lead',
  targetDate: 'Target date',
  description: 'Description',
  descriptionPlaceholder: 'What this epic is for, and what done looks like.',
  issues: 'Tickets',
  loadingIssues: 'Loading tickets…',
  showing_one:
    'Showing {{shown}} of {{count}} ticket. Filter the board to this epic to page through the rest.',
  showing_other:
    'Showing {{shown}} of {{count}} tickets. Filter the board to this epic to page through the rest.',
  unassigned: 'Unassigned',
  removeIssue: 'Remove {{identifier}} from {{project}}',
  removeFromProject: 'Remove from epic',
  empty: {
    title: 'No tickets in this epic yet',
    search: 'Add existing tickets here, found by searching.',
    create: 'Pick this epic in the Epic field when creating a ticket.',
    details: "Or set Epic in any ticket's details, or on a selection from the board.",
  },
  errors: {
    save: 'Could not save that change.',
    remove: 'Could not remove {{identifier}}.',
  },
} as const

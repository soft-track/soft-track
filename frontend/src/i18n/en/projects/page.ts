/** Projects → a project's own page: its header, its fields, and its issues by column. */
export const page = {
  loading: 'Loading project…',
  notFound: 'This project does not exist on {{team}}. It may have been deleted.',
  backToBoard: 'Back to the board',
  archived: 'Archived',
  onTheBoard: 'On the board',
  addIssues: 'Add issues',
  nothingYet: 'Nothing in this project yet',
  progress: 'Progress',
  progressNote: 'Cancelled issues count towards neither number.',
  state: 'State',
  lead: 'Lead',
  noLead: 'No lead',
  targetDate: 'Target date',
  description: 'Description',
  descriptionPlaceholder: 'What this project is for, and what done looks like.',
  issues: 'Issues',
  loadingIssues: 'Loading issues…',
  showing_one:
    'Showing {{shown}} of {{count}} issue. Filter the board to this project to page through the rest.',
  showing_other:
    'Showing {{shown}} of {{count}} issues. Filter the board to this project to page through the rest.',
  unassigned: 'Unassigned',
  removeIssue: 'Remove {{identifier}} from {{project}}',
  removeFromProject: 'Remove from project',
  empty: {
    title: 'No issues in this project yet',
    search: 'Add existing issues here, found by searching.',
    create: 'Pick this project in the Project field when creating an issue.',
    details: "Or set Project in any issue's details, or on a selection from the board.",
  },
  errors: {
    save: 'Could not save that change.',
    remove: 'Could not remove {{identifier}}.',
  },
} as const

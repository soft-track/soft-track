/** The new-ticket form. */
export const newTicket = {
  title: 'New ticket',
  replaceDescription:
    'Replace the description you have written with the “{{name}}” template?',
  template: 'Template',
  noTemplate: 'No template',
  ticketTitle: 'Ticket title',
  descriptionPlaceholder: 'Add a description… Markdown works here.',
  similarTickets: 'Similar tickets',
  dismissSimilarTickets: 'Dismiss similar tickets',
  opensInNewTab: '(opens in a new tab)',
  status: 'Status',
  type: 'Type',
  /** What a bug is asked as well (#273). */
  severity: 'Severity',
  noSeverity: 'No severity',
  environment: 'Environment',
  noEnvironment: 'No environment',
  foundIn: 'Found in',
  notFoundIn: 'Found in no release',
  /** The sections of a new bug's description: headings in its markdown. */
  bug: {
    steps: 'Steps to reproduce',
    expected: 'Expected',
    actual: 'Actual',
  },
  priority: 'Priority',
  estimate: 'Estimate',
  noEstimate: 'No estimate',
  sprint: 'Sprint',
  // The sprint picker's empty choice: not in any sprint.
  noSprint: 'Backlog',
  dueDate: 'Due date',
  project: 'Epic',
  noProject: 'No epic',
  assignee: 'Assignee',
  unassigned: 'Unassigned',
  create: 'Create ticket',
  creating: 'Creating…',
  errors: {
    create: 'Could not create the ticket. Please try again.',
  },
} as const

/** The new-ticket form. */
export const newTicket = {
  title: 'New ticket',
  replaceDescription:
    'Replace the description you have written with the “{{name}}” template?',
  template: 'Template',
  noTemplate: 'No template',
  ticketTitle: 'Ticket title',
  descriptionPlaceholder: 'Add a description… Markdown works here.',
  status: 'Status',
  type: 'Type',
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

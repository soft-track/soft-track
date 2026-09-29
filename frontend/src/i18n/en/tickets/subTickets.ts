/** Ticket panel → Sub-tickets: the parent's checklist of children. */
export const subTickets = {
  title: 'Sub-tickets',
  progress: '{{done}}/{{total}} done',
  placeholder: 'Sub-ticket title, then Enter',
  complete: 'Complete {{identifier}}',
  reopen: 'Reopen {{identifier}}',
  errors: {
    add: 'Could not add that sub-ticket.',
  },
} as const

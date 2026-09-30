/** Settings → a team → Trash (#323): what was deleted, and a way back. */
export const trash = {
  title: 'Trash',
  intro: 'What was deleted from {{team}}. It comes back with its comments, links, attachments and history.',
  kinds: 'What was deleted',
  tickets: 'Tickets',
  epics: 'Epics',
  emptyTickets: 'No tickets in the trash.',
  emptyEpics: 'No epics in the trash.',
  deletedBy: 'deleted by {{name}}, {{when}}',
  deletedByNobody: 'deleted {{when}}',
  // How long until the purge takes it: rounded up, so "1 day" until it is gone.
  purgedIn_one: 'purged in {{count}} day',
  purgedIn_other: 'purged in {{count}} days',
  epicTickets_one: '{{count}} ticket rejoins it',
  epicTickets_other: '{{count}} tickets rejoin it',
  restore: 'Restore',
  restoreNamed: 'Restore {{name}}',
  deleteForever: 'Delete forever',
  deleteForeverNamed: 'Delete {{name}} forever',
  confirmTicket:
    'Delete {{identifier}} forever? Its comments, links, attachments and history go with it, and it cannot be restored.',
  confirmEpic:
    'Delete the epic “{{name}}” forever? Its tickets are kept, with no epic, and it cannot be restored.',
  footer_one: 'Purged {{count}} day after deleting, and that is when attachments are removed from storage.',
  footer_other: 'Purged {{count}} days after deleting, and that is when attachments are removed from storage.',
  adminsPurge: 'Team admins can delete forever sooner.',
  errors: {
    restore: 'Could not restore that.',
    purge: 'Could not delete that forever.',
  },
} as const

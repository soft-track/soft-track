/** Ticket panel: the slide-over's header, its ⋯ menu, the title, Files and the "Created by" line. */
export const panel = {
  // The dialog's name while the ticket is still loading.
  loading: 'Ticket',
  importedKey: "This ticket's key before it was imported",
  closeHint: 'Close (Esc)',
  // The way out of the panel to the ticket's own page (#112), beside Close.
  openAsPage: 'Open as page',
  title: 'Title',
  files: 'Files',
  // The properties' own landmark: a column beside the reading on a wide page (#112).
  details: 'Details',
  createdBy: 'Created by <person>{{name}}</person> {{when}}',
  actions: {
    more: 'More actions',
    menu: 'Ticket actions',
    moveToTeam: 'Move to another team…',
  },
} as const

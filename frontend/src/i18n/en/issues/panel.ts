/** Issue panel: the slide-over's header, its ⋯ menu, the title, Files and the "Created by" line. */
export const panel = {
  // The dialog's name while the issue is still loading.
  loading: 'Issue',
  importedKey: "This issue's key before it was imported",
  closeHint: 'Close (Esc)',
  // The way out of the panel to the issue's own page (#112), beside Close.
  openAsPage: 'Open as page',
  title: 'Title',
  files: 'Files',
  // The properties' own landmark: a column beside the reading on a wide page (#112).
  details: 'Details',
  createdBy: 'Created by {{name}} {{when}}',
  actions: {
    more: 'More actions',
    menu: 'Issue actions',
    moveToTeam: 'Move to another team…',
  },
} as const

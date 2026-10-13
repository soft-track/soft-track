/** Board → the list view: its rows, project sections and empty state. */
export const list = {
  empty: 'No tickets match the current filters.',
  noProject: 'No epic',
  /** Read out before a selected row; the trailing space keeps it apart from the row's text. */
  selected: 'Selected. ',
  /** When the list is narrowed or sorted by when tickets changed (#261): "updated 41 days ago". */
  updated: 'updated {{when}}',
} as const

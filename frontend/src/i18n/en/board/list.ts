/** Board → the list view: its rows, project sections and empty state. */
export const list = {
  empty: 'No issues match the current filters.',
  noProject: 'No project',
  /** Read out before a selected row; the trailing space keeps it apart from the row's text. */
  selected: 'Selected. ',
} as const

/** How the board is arranged: the grouping and sort choices, wherever they are offered. */
export const arrange = {
  grouping: {
    status: 'By status',
    project: 'By epic',
    release: 'By release',
  },
  /** The column, or the list's section, for tickets with none of it. */
  none: {
    project: 'No epic',
    release: 'No release',
  },
  sort: {
    created: 'Created',
    updated: 'Updated',
    priority: 'Priority',
    estimate: 'Estimate',
    title: 'Title',
  },
} as const

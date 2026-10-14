/** How the board is arranged: the grouping and sort choices, wherever they are offered. */
export const arrange = {
  grouping: {
    status: 'By status',
    project: 'By epic',
    release: 'By release',
    severity: 'By severity',
    environment: 'By environment',
  },
  /** The column, or the list's section, for tickets with none of it. */
  none: {
    project: 'No epic',
    release: 'No release',
    severity: 'No severity',
    environment: 'No environment',
  },
  sort: {
    created: 'Created',
    updated: 'Updated',
    priority: 'Priority',
    estimate: 'Estimate',
    title: 'Title',
    severity: 'Severity',
  },
} as const

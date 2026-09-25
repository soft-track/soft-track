/** How the board is arranged: the grouping and sort choices, wherever they are offered. */
export const arrange = {
  grouping: {
    status: 'By status',
    project: 'By project',
  },
  sort: {
    created: 'Created',
    updated: 'Updated',
    priority: 'Priority',
    estimate: 'Estimate',
    title: 'Title',
  },
} as const

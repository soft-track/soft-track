/** Board → the Filter button and popover, the active-filter chips, a saved view's summary. */
export const filters = {
  button: 'Filter',
  dialogLabel: 'Filter tickets',
  clearAll: 'Clear',
  saveView: 'Save view',
  /** What is being filtered on: the popover's field labels and each chip's first word. */
  fields: {
    status: 'Status',
    priority: 'Priority',
    assignee: 'Assignee',
    label: 'Label',
    project: 'Epic',
    sprint: 'Sprint',
    type: 'Type',
    due: 'Due',
  },
  /** The ×'s label on each chip, by the filter it clears. */
  clearChip: {
    statusId: 'Clear status filter',
    priority: 'Clear priority filter',
    assignee: 'Clear assignee filter',
    labelId: 'Clear label filter',
    projectId: 'Clear epic filter',
    sprintId: 'Clear sprint filter',
    type: 'Clear type filter',
    due: 'Clear due filter',
  },
  any: {
    status: 'Any status',
    priority: 'Any priority',
    assignee: 'Anyone',
    label: 'Any label',
    project: 'Any epic',
    sprint: 'Any sprint',
    type: 'Any type',
    due: 'Any due date',
  },
  unassigned: 'Unassigned',
  /** A chip whose filter points at something that has since gone. */
  missing: {
    status: 'Deleted status',
    assignee: 'Someone else',
    label: 'Deleted label',
    project: 'Deleted epic',
    sprint: 'Deleted sprint',
  },
  /** A saved view with no filters, in the sidebar. */
  allTickets: 'All tickets',
} as const

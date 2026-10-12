/** Board → the Filter button and popover, the active-filter chips, a saved view's summary. */
export const filters = {
  button: 'Filter',
  dialogLabel: 'Filter tickets',
  clearAll: 'Clear all',
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
  /** The × beside each value in a chip: "Remove Mei Tanaka from the assignee filter". */
  removeValue: 'Remove {{value}} from the {{field}} filter',
  /** Between the values in a chip: "Mei or Daniel"; labels that must all be there: "Bug and Design". */
  or: 'or',
  and: 'and',
  /** Before the values of a filter that excludes them: "not Done". */
  not: 'not',
  /** Each filter's switch in the menu, which turns it round (#260). */
  except: {
    status: 'Every status except these',
    priority: 'Every priority except these',
    assignee: 'Everyone except these',
    label: 'Every ticket without these',
    type: 'Every type except these',
  },
  /** The label filter's second question. */
  labelMatch: {
    label: 'Match',
    any: 'Any of these',
    all: 'All of these',
  },
  /** A menu section's summary when nothing is chosen in it. */
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

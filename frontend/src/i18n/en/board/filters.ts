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
    creator: 'Created by',
    updated: 'Updated',
    created: 'Created',
    hasNo: 'Has no',
    watching: 'Watching',
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
    creator: 'Everyone except these',
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
    creator: 'Anyone',
    updated: 'Any time',
    created: 'Any time',
    hasNo: 'Anything',
    watching: 'Watched or not',
  },
  unassigned: 'Unassigned',
  /** "Me" as a value of the assignee and created-by filters (#261): whoever is looking. */
  me: 'Me',
  /** When a ticket was updated or created (#261): the menu's choices. */
  when: {
    last_7_days: 'In the last 7 days',
    last_30_days: 'In the last 30 days',
    over_30_days: 'More than 30 days ago',
    before: 'Before a date…',
    after: 'After a date…',
    between: 'Between two dates…',
    /** The date fields under a choice of dates. */
    date: 'Date',
    from: 'From',
    to: 'To',
  },
  /** The same, as a chip says it: "Updated more than 30 days ago". */
  whenChip: {
    last_7_days: 'last 7 days',
    last_30_days: 'last 30 days',
    over_30_days: 'more than 30 days ago',
    before: 'before {{date}}',
    after: 'after {{date}}',
    between: '{{from}} – {{to}}',
  },
  /** A date in a chip: "3 Sep 2026". */
  chipDatePattern: 'd MMM yyyy',
  /** What a ticket can have none of: "Has no estimate". */
  hasNo: {
    estimate: 'estimate',
    epic: 'epic',
    sprint: 'sprint',
  },
  /** The watching filter's one box, and its chip: "Watched by me". */
  watching: {
    option: 'Only tickets I am watching',
    chipField: 'Watched by',
    chipValue: 'me',
  },
  /** A chip whose filter points at something that has since gone. */
  missing: {
    status: 'Deleted status',
    assignee: 'Someone else',
    label: 'Deleted label',
    project: 'Deleted epic',
    sprint: 'Deleted sprint',
    creator: 'Someone else',
  },
  /** A saved view with no filters, in the sidebar. */
  allTickets: 'All tickets',
} as const

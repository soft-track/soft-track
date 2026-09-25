/** Issue panel → Time: the time logged on an issue, and the form that logs it (#102). */
export const time = {
  /** One worklog row: who, how long, which day, and the note if there is one. */
  entry: '<who>{{name}}</who> <duration>{{duration}}</duration> <day>{{day}}</day>',
  entryWithNote:
    '<who>{{name}}</who> <duration>{{duration}}</duration> <day>{{day}}</day><note> — {{note}}</note>',
  title: 'Time',
  logged: '{{duration}} logged',
  logTime: 'Log time',
  byPerson: 'Time by person',
  editEntry: 'Edit {{duration}} logged {{day}}',
  deleteEntry: 'Delete {{duration}} logged {{day}}',
  showRecent: 'Show recent',
  showAll_one: 'Show all {{count}}',
  showAll_other: 'Show all {{count}}',
  day: {
    today: 'today',
    yesterday: 'yesterday',
    daysAgo_one: '{{count}} day ago',
    daysAgo_other: '{{count}} days ago',
    on: 'on {{date}}',
    // A date-fns pattern: "12 Sep".
    pattern: 'd MMM',
  },
  form: {
    log: 'Log',
    spent: 'Time spent',
    spentPlaceholder: '2h 30m',
    on: 'On',
    note: 'Note',
    notePlaceholder: 'Debugging the webhook retry',
    // What parseDuration accepts, which is English whatever the page says.
    invalid: 'Try something like 2h 30m, 45m or 1.5h.',
    error: 'Could not save that time.',
  },
} as const

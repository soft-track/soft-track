/** The vocabulary other folders read through `issueMeta`, `dueDate` and `duration`. */
export const meta = {
  category: {
    backlog: { label: 'Backlog', hint: 'Not committed to yet' },
    unstarted: { label: 'Unstarted', hint: 'Accepted, not begun' },
    started: { label: 'Started', hint: 'Work in flight' },
    done: { label: 'Done', hint: 'Finished' },
    cancelled: { label: 'Cancelled', hint: 'Closed without being delivered' },
  },
  priority: {
    urgent: 'Urgent',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    no_priority: 'No priority',
  },
  type: { bug: 'Bug', task: 'Task', story: 'Story' },
  due: {
    overdue: 'Overdue',
    this_week: 'Due this week',
    none: 'No due date',
    // date-fns patterns: the order of day and month is the language's, not ours.
    shortPattern: 'MMM d',
    longPattern: 'EEEE d MMMM yyyy',
  },
  duration: {
    minutes: '{{minutes}}m',
    hours: '{{hours}}h',
    both: '{{hours}}h {{minutes}}m',
  },
} as const

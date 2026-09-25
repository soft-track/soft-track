/** The banner above the board for the selected cycle: its progress, and starting or ending it. */
export const banner = {
  progress_one:
    '<num>{{issuesCompleted}}/{{count}}</num> issue · <num>{{pointsCompleted}}/{{pointsTotal}}</num> pts',
  progress_other:
    '<num>{{issuesCompleted}}/{{count}}</num> issues · <num>{{pointsCompleted}}/{{pointsTotal}}</num> pts',
  /** The same, with the issues not yet sized; the space before the bracket is inside `<muted>`. */
  progressUnsized_one:
    '<num>{{issuesCompleted}}/{{count}}</num> issue · <num>{{pointsCompleted}}/{{pointsTotal}}</num> pts<muted> ({{unsized}} unsized)</muted>',
  progressUnsized_other:
    '<num>{{issuesCompleted}}/{{count}}</num> issues · <num>{{pointsCompleted}}/{{pointsTotal}}</num> pts<muted> ({{unsized}} unsized)</muted>',
  unsizedHint: 'Points totals are only as honest as this number is small',
  start: 'Start cycle',
  complete: 'Complete cycle',
  completed: 'Completed',
  started: 'Cycle started.',
  completedAllDone: 'Cycle completed with everything finished.',
  completedToNext_one: 'Cycle completed. {{count}} unfinished issue moved to the next cycle.',
  completedToNext_other: 'Cycle completed. {{count}} unfinished issues moved to the next cycle.',
  completedToBacklog_one: 'Cycle completed. {{count}} unfinished issue moved to the backlog.',
  completedToBacklog_other: 'Cycle completed. {{count}} unfinished issues moved to the backlog.',
  error: 'That did not work.',
} as const

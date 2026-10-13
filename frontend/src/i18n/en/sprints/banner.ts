/** The banner above the board for the selected sprint: its progress, and starting or ending it. */
export const banner = {
  progress_one:
    '<num>{{ticketsCompleted}}/{{count}}</num> ticket · <num>{{pointsCompleted}}/{{pointsTotal}}</num> pts',
  progress_other:
    '<num>{{ticketsCompleted}}/{{count}}</num> tickets · <num>{{pointsCompleted}}/{{pointsTotal}}</num> pts',
  /** The same, with the tickets not yet sized; the space before the bracket is inside `<muted>`. */
  progressUnsized_one:
    '<num>{{ticketsCompleted}}/{{count}}</num> ticket · <num>{{pointsCompleted}}/{{pointsTotal}}</num> pts<muted> ({{unsized}} unsized)</muted>',
  progressUnsized_other:
    '<num>{{ticketsCompleted}}/{{count}}</num> tickets · <num>{{pointsCompleted}}/{{pointsTotal}}</num> pts<muted> ({{unsized}} unsized)</muted>',
  unsizedHint: 'Points totals are only as honest as this number is small',
  start: 'Start sprint',
  complete: 'Complete sprint',
  completed: 'Completed',
  started: 'Sprint started.',
  completedAllDone: 'Sprint completed with everything finished.',
  completedToNext_one: 'Sprint completed. {{count}} unfinished ticket moved to the next sprint.',
  completedToNext_other: 'Sprint completed. {{count}} unfinished tickets moved to the next sprint.',
  completedToBacklog_one: 'Sprint completed. {{count}} unfinished ticket moved to the backlog.',
  completedToBacklog_other: 'Sprint completed. {{count}} unfinished tickets moved to the backlog.',
  error: 'That did not work.',
} as const

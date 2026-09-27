/** Projects → the roadmap: the team's projects by the month they are due (#62). */
export const roadmap = {
  // date-fns patterns: a month's heading, and a project's target day.
  monthPattern: 'MMMM yyyy',
  dayPattern: 'd MMM',
  undatedSection: 'No target date',
  empty: 'No epics on {{team}} yet.',
  emptyHint: 'An epic with a target date shows up here under its month.',
  undated_one: '{{count}} epic has no target date — listed at the bottom.',
  undated_other: '{{count}} epics have no target date — listed at the bottom.',
  thisMonth: 'This month',
  noIssues: 'No tickets yet',
  noLead: 'No lead',
  overdue: 'Overdue',
} as const

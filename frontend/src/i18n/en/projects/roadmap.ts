/** Projects → the roadmap: the team's projects by the month they are due (#62). */
export const roadmap = {
  // date-fns patterns: a month's heading, and a project's target day.
  monthPattern: 'MMMM yyyy',
  dayPattern: 'd MMM',
  undatedSection: 'No target date',
  empty: 'No projects on {{team}} yet.',
  emptyHint: 'A project with a target date shows up here under its month.',
  undated_one: '{{count}} project has no target date — listed at the bottom.',
  undated_other: '{{count}} projects have no target date — listed at the bottom.',
  thisMonth: 'This month',
  noIssues: 'No issues yet',
  noLead: 'No lead',
  overdue: 'Overdue',
} as const

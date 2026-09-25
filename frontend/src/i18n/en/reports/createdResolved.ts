/** Created vs resolved, with the backlog those two produce plotted below. */
export const createdResolved = {
  title: 'Created vs resolved',
  note:
    '{{opened}} opened and {{closed}} closed in this window. The lower plot is the backlog those two lines produce.',
  empty: 'Nothing opened or closed in this window.',
  created: 'Created',
  resolved: 'Resolved',
  open: 'Open',
  openIssues: 'Open issues',
  chart: 'Issues created and resolved per day',
  backlogChart: 'Open issues at the end of each day',
} as const

/** Ticket panel → the block of properties: status, priority, estimate, sprint and the rest. */
export const properties = {
  status: 'Status',
  priority: 'Priority',
  type: 'Type',
  /** A bug's details (#273). */
  severity: 'Severity',
  noSeverity: 'Not rated',
  environment: 'Environment',
  noEnvironment: 'None',
  estimate: 'Estimate',
  notSized: 'Not sized',
  points_one: '{{count}} point',
  points_other: '{{count}} points',
  sprint: 'Sprint',
  backlog: 'Backlog',
  dueDate: 'Due date',
  project: 'Epic',
  noProject: 'No epic',
  assignee: 'Assignee',
  unassigned: 'Unassigned',
  labels: 'Labels',
  noLabels: 'No labels on this team yet.',
} as const

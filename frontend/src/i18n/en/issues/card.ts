/** The issue card on a board or list, and the badges and icons on it. */
export const card = {
  // Screen-reader only, read before the rest of the card.
  selected: 'Selected. ',
  subIssuesDone_one: '{{done}} of {{count}} sub-issues done',
  subIssuesDone_other: '{{done}} of {{count}} sub-issues done',
  unassigned: 'Unassigned',
  projectTitle: 'Project: {{name}}',
  // Screen-reader only, after the project's name.
  /** What a screen reader hears for the badge: the name, and what it is. */
  projectSpoken: '{{name}} (project)',
  blockedBy_one: 'Blocked by {{count}} unresolved issue',
  blockedBy_other: 'Blocked by {{count}} unresolved issues',
  blocked: 'Blocked',
  due: 'Due {{date}}',
  dueOverdue: 'Due {{date}} — overdue',
  // Screen-reader only, after the short date.
  overdueSpoken: '{{date}} (overdue)',
  points_one: '{{count}} point',
  points_other: '{{count}} points',
} as const

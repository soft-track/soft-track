/** A project's burnup (#64): scope against completed work, in issues or in points. */
export const burnup = {
  title: 'Burnup',
  note:
    'Scope against completed work since {{date}}, the first day history records anything about this project. Cancelled issues count as neither.',
  empty:
    'No history for this project yet. The chart starts on the first day an issue is moved into it or out of it.',
  scope: 'Scope',
  completed: 'Completed',
  unestimated: 'Unestimated',
  measure: 'Measure',
  issues: 'Issues',
  points: 'Points',
  chart: {
    issues: 'Burnup for {{project}}, in issues',
    points: 'Burnup for {{project}}, in points',
  },
  /** The label on the latest day; a `+` scope is a floor, some of it unsized. */
  latest: {
    issues_one: '{{done}} of {{count}} issue',
    issues_other: '{{done}} of {{count}} issues',
    points: '{{done}} of {{scope}} pts',
    pointsFloor: '{{done}} of {{scope}}+ pts',
  },
  /** A tooltip value. */
  value: {
    issues_one: '{{count}} issue',
    issues_other: '{{count}} issues',
    points: '{{value}} pts',
  },
  floor_one:
    '{{count}} issue in scope has no estimate, so the points scope is a floor, not the size of the project.',
  floor_other:
    '{{count}} issues in scope have no estimate, so the points scope is a floor, not the size of the project.',
} as const

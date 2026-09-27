/** A project's burnup (#64): scope against completed work, in issues or in points. */
export const burnup = {
  title: 'Burnup',
  note:
    'Scope against completed work since {{date}}, the first day history records anything about this epic. Cancelled tickets count as neither.',
  empty:
    'No history for this epic yet. The chart starts on the first day a ticket is moved into it or out of it.',
  scope: 'Scope',
  completed: 'Completed',
  unestimated: 'Unestimated',
  measure: 'Measure',
  issues: 'Tickets',
  points: 'Points',
  chart: {
    issues: 'Burnup for {{project}}, in tickets',
    points: 'Burnup for {{project}}, in points',
  },
  /** The label on the latest day; a `+` scope is a floor, some of it unsized. */
  latest: {
    issues_one: '{{done}} of {{count}} ticket',
    issues_other: '{{done}} of {{count}} tickets',
    points: '{{done}} of {{scope}} pts',
    pointsFloor: '{{done}} of {{scope}}+ pts',
  },
  /** A tooltip value. */
  value: {
    issues_one: '{{count}} ticket',
    issues_other: '{{count}} tickets',
    points: '{{value}} pts',
  },
  floor_one:
    '{{count}} ticket in scope has no estimate, so the points scope is a floor, not the size of the epic.',
  floor_other:
    '{{count}} tickets in scope have no estimate, so the points scope is a floor, not the size of the epic.',
} as const

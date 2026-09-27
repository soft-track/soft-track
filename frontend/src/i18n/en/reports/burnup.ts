/** A project's burnup (#64): scope against completed work, in tickets or in points. */
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
  tickets: 'Tickets',
  points: 'Points',
  chart: {
    tickets: 'Burnup for {{project}}, in tickets',
    points: 'Burnup for {{project}}, in points',
  },
  /** The label on the latest day; a `+` scope is a floor, some of it unsized. */
  latest: {
    tickets_one: '{{done}} of {{count}} ticket',
    tickets_other: '{{done}} of {{count}} tickets',
    points: '{{done}} of {{scope}} pts',
    pointsFloor: '{{done}} of {{scope}}+ pts',
  },
  /** A tooltip value. */
  value: {
    tickets_one: '{{count}} ticket',
    tickets_other: '{{count}} tickets',
    points: '{{value}} pts',
  },
  floor_one:
    '{{count}} ticket in scope has no estimate, so the points scope is a floor, not the size of the epic.',
  floor_other:
    '{{count}} tickets in scope have no estimate, so the points scope is a floor, not the size of the epic.',
} as const

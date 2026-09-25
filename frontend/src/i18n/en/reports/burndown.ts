/** The cycle burndown: points outstanding against the ideal line. */
export const burndown = {
  title: 'Burndown · {{cycle}}',
  note:
    "Points still outstanding each day. The dashed line runs from the cycle's opening scope to zero — work added later does not move it.",
  notStarted: 'This cycle has not started yet.',
  remaining: 'Remaining',
  ideal: 'Ideal',
  scopeChanged: 'Scope changed',
  scope: 'Scope',
  issuesLeft: 'Issues left',
  chart: 'Burndown for {{cycle}}',
  /** The label on the last point. */
  left: '{{points}} left',
  points: '{{points}} pts',
} as const

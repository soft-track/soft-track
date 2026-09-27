/** The sprint burndown: points outstanding against the ideal line. */
export const burndown = {
  title: 'Burndown · {{sprint}}',
  note:
    "Points still outstanding each day. The dashed line runs from the sprint's opening scope to zero — work added later does not move it.",
  notStarted: 'This sprint has not started yet.',
  remaining: 'Remaining',
  ideal: 'Ideal',
  scopeChanged: 'Scope changed',
  scope: 'Scope',
  issuesLeft: 'Tickets left',
  chart: 'Burndown for {{sprint}}',
  /** The label on the last point. */
  left: '{{points}} left',
  points: '{{points}} pts',
} as const

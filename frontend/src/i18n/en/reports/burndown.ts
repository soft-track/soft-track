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
  ticketsLeft: 'Tickets left',
  chart: 'Burndown for {{sprint}}',
  /** The label on the last point. */
  left: '{{points}} left',
  points: '{{points}} pts',
  // The same in hours (#268), for a team that estimates in them.
  noteHours:
    "Hours still left each day: the time estimate less what is logged, or what somebody said is left. The dashed line runs from the first day's figure to zero.",
  unit: 'Burndown in',
  unitPoints: 'Points',
  unitHours: 'Hours',
} as const

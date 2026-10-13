/**
 * Time estimates in hours (#268): the property beside the points, the bar of
 * logged against estimated, what is left when logging time, and a sprint's
 * or an epic's totals.
 */
export const timeEstimate = {
  property: 'Time estimate',
  placeholder: 'None',
  // What parseDuration accepts, which is English whatever the page says.
  invalid: 'Try something like 10h, 2h 30m or 90m.',
  error: 'Could not save the time estimate.',
  /** The Time section's heading line, once there is an estimate. */
  loggedOf: '{{logged}} logged of {{estimated}} · {{left}} left',
  loggedOfWithSubtickets: '{{logged}} logged of {{estimated}} · {{left}} left, with sub-tickets',
  bar: 'Time logged against the estimate',
  /** Said in words, so over is not shown by colour alone. */
  over: 'over by {{duration}}',
  remaining: {
    label: 'How much is left?',
    workedOut:
      'Worked out as {{left}}: {{estimated}} estimated, {{logged}} logged with this. Change it if there is more to do.',
    workedOutFromSet:
      'Worked out as {{left}}: {{before}} was left, less this. Change it if there is more to do.',
    invalid: 'Try something like 3h, 1h 30m or 0.',
  },
  rollup: {
    sprint: 'The sprint',
    epic: 'Epic: {{name}}',
    of: '{{logged}} of {{estimated}}',
    left: '{{left}} left',
    daysToGo_one: '{{count}} day to go',
    daysToGo_other: '{{count}} days to go',
    overList: 'Over their estimate',
  },
} as const

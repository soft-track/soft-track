/** The reports page: its filters, the burndown's placeholder, and the note on history. */
export const view = {
  cycle: 'Cycle',
  noCycles: 'No cycles',
  window: 'Window',
  /** A window tab: the last this many days. */
  windowDays: '{{days}}d',
  burndown: 'Burndown',
  burndownNoCycles: 'Create a cycle to see a burndown.',
  cycleTime: {
    title: 'Time in {{cycle}}',
    note: 'Logged during the cycle on issues that were in it.',
  },
  windowTime: {
    title_one: 'Time, last {{count}} day',
    title_other: 'Time, last {{count}} days',
    note: "Logged on this team's issues.",
  },
  history:
    'Charts are built from recorded issue history, so they begin from the day history started being kept — earlier activity cannot be reconstructed.',
} as const

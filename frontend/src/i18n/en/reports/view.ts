/** The reports page: its filters, the burndown's placeholder, and the note on history. */
export const view = {
  sprint: 'Sprint',
  noSprints: 'No sprints',
  window: 'Window',
  /** A window tab: the last this many days. */
  windowDays: '{{days}}d',
  burndown: 'Burndown',
  burndownNoSprints: 'Create a sprint to see a burndown.',
  sprintTime: {
    title: 'Time in {{sprint}}',
    note: 'Logged during the sprint on tickets that were in it.',
  },
  windowTime: {
    title_one: 'Time, last {{count}} day',
    title_other: 'Time, last {{count}} days',
    note: "Logged on this team's tickets.",
  },
  history:
    'Charts are built from recorded ticket history, so they begin from the day history started being kept — earlier activity cannot be reconstructed.',
} as const

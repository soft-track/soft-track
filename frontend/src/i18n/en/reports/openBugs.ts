/** Open bugs by severity, week by week (#273), beside created vs resolved. */
export const openBugs = {
  title: 'Open bugs, by severity',
  note_one: 'What is open at the end of each week. {{count}} open now.',
  note_other: 'What is open at the end of each week. {{count}} open now.',
  empty: 'No bugs were open in these weeks.',
  chart: 'Open bugs by severity at the end of each week',
  unrated: 'Not rated',
  /** A week on the axis, by its Monday: "24 Aug". */
  weekPattern: 'd MMM',
  /** The tooltip's heading: "Week of 24 Aug". */
  weekOf: 'Week of {{date}}',
} as const

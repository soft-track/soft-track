/** The command palette itself: the search field, issue results, and the key hints below. */
export const palette = {
  label: 'Command palette',
  placeholder: 'Jump to an issue, or type a command…',
  inputLabel: 'Command',
  issuesGroup: 'Issues',
  issueHint: '{{identifier}} · {{status}}',
  noMatches: 'Nothing matches “{{query}}”.',
  navigate: 'navigate',
  open: 'open',
  close: 'close',
} as const

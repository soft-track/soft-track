/** The bar across the top of the board: views, arrangement, search, new ticket. */
export const topBar = {
  openNavigation: 'Open navigation',
  viewLabel: 'View',
  views: {
    board: 'Board',
    list: 'List',
    calendar: 'Calendar',
    roadmap: 'Roadmap',
    reports: 'Reports',
  },
  groupBy: 'Group by',
  sortBy: 'Sort by',
  ascending: 'Ascending',
  descending: 'Descending',
  switchToDescending: 'Ascending; switch to descending',
  switchToAscending: 'Descending; switch to ascending',
  searchLabel: 'Search tickets',
  searchPlaceholder: 'Search tickets…',
  clearSearch: 'Clear search',
  newTicket: 'New ticket',
  viewOnly: 'View only',
  viewOnlyHint: 'You are a guest on this team: you can see everything and change nothing.',
  /** The CSV export (#165): the button, and its tooltip for each state. */
  export: {
    label: 'Export CSV',
    exporting: 'Exporting…',
    failed: 'Export failed',
    hint: 'Download these tickets as CSV',
    failedHint: 'The export failed. Try again.',
    searchingHint:
      'Clear the search to export. An export uses the board filters, not the search results.',
  },
} as const

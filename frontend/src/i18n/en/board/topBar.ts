/** The bar across the top of the board: views, arrangement, search, new issue. */
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
  searchLabel: 'Search issues',
  searchPlaceholder: 'Search issues…',
  clearSearch: 'Clear search',
  newIssue: 'New issue',
  viewOnly: 'View only',
  viewOnlyHint: 'You are a guest on this team: you can see everything and change nothing.',
} as const

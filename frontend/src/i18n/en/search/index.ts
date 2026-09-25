/** Search: the results list, its empty and loading states, and where each hit matched. */
export const search = {
  searching: 'Searching…',
  empty: 'Nothing matches <query>“{{query}}”</query>.',
  emptyHint: 'Titles, descriptions and comments were all searched.',
  results_one: '<n>{{count}}</n> result for <query>“{{query}}”</query>',
  results_other: '<n>{{count}}</n> results for <query>“{{query}}”</query>',
  // More hits than the page holds.
  resultsFirst_one:
    '<n>{{count}}</n> result for <query>“{{query}}”</query> · showing the first {{shown}}',
  resultsFirst_other:
    '<n>{{count}}</n> results for <query>“{{query}}”</query> · showing the first {{shown}}',
  // Where the match was, then when the issue last changed.
  matchedIn: {
    title: 'matched in title · {{when}}',
    description: 'matched in description · {{when}}',
    comment: 'matched in a comment · {{when}}',
    other: 'matched in {{place}} · {{when}}',
  },
} as const

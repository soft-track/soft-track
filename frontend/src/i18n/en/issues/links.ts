/** Issue panel → Links: blockers, duplicates and related issues, and adding one. */
export const links = {
  title: 'Links',
  // One heading per bucket, keyed by the API's field.
  groups: {
    blocked_by: 'Blocked by',
    blocks: 'Blocks',
    duplicates: 'Duplicates',
    duplicated_by: 'Duplicated by',
    relates_to: 'Related',
  },
  // The kinds of link that can be created from here, keyed by link type.
  types: {
    blocks: 'blocks',
    relates_to: 'relates to',
    duplicates: 'duplicates',
  },
  search: 'Search by identifier or title…',
  noMatches: 'Nothing matches.',
  remove: 'Remove link to {{identifier}}',
  errors: {
    add: 'Could not add that link.',
  },
} as const

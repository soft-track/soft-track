/** Every assignee picker (#316): the members first, then the guests. */
export const assignee = {
  // An <optgroup> label. Guests are listed so nobody wonders where they went,
  // but a guest reads the team and holds none of its work.
  guests: 'Guests · read-only',
  // An account a site admin made, not signed into yet (#303). Assignable all
  // the same: the work is waiting for them when they arrive.
  notActivated: '{{name}} · not yet activated',
} as const

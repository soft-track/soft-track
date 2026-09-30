/** Every assignee picker (#316): the members first, then the guests. */
export const assignee = {
  // An <optgroup> label. Guests are listed so nobody wonders where they went,
  // but a guest reads the team and holds none of its work.
  guests: 'Guests · read-only',
} as const

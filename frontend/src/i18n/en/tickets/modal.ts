/** A linked ticket in a modal over the one you are reading (#114). */
export const modal = {
  // The chip at the top left, saying what it was opened over. One deep it
  // names that ticket; two deep, the trail of both, joined by `trailSeparator`.
  from: 'from {{identifier}}',
  trailSeparator: ' › ',
  // The same chip's tooltip: pressing it closes this modal.
  backTo: 'Back to {{identifier}}',
  // On a row in the deepest modal, where a link opens the ticket's page
  // rather than a third modal.
  opensPage: 'Opens the page',
  // A link can cross teams, and the other ticket's team may not be yours.
  notOnTeam: '{{identifier}} is on a team you are not a member of.',
} as const

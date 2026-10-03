/** The kanban board: its columns, and what a screen reader hears while moving a card. */
export const kanban = {
  noProject: 'No epic',
  pointsShort: '{{points}} pts',
  pointsTitle: '{{points}} points',
  pointsTitleUnsized_one: '{{points}} points, with {{count}} ticket not yet sized',
  pointsTitleUnsized_other: '{{points}} points, with {{count}} tickets not yet sized',
  collapseNamed: 'Collapse {{name}}',
  collapseColumn: 'Collapse column',
  dropHere: 'Drop here',
  noTickets: 'No tickets',
  /** A column against its WIP limit (#270): "4 / 3", and in words when over. */
  wip: {
    count: '{{count}}/{{limit}}',
    countTitle: '{{count}} tickets, against a limit of {{limit}}',
    full: 'full',
    overBy: 'over by {{count}}',
  },
  expandNamed_one: 'Expand {{name}}, {{count}} ticket',
  expandNamed_other: 'Expand {{name}}, {{count}} tickets',
  collapsedTitle: '{{name}} · {{count}}',
  /** A ticket the board cannot name, in an announcement. */
  theTicket: 'The ticket',
  keyboard: {
    instructions:
      'To move this ticket, press Shift and Space to pick it up. The left and right arrow keys choose a column, up and down move it past the cards above and below, and Space drops it. Escape cancels. Enter opens the ticket, and Space on its own shows a preview of it.',
    pickedUp:
      'Picked up {{ticket}}. Use the arrow keys to move it, Space to drop, Escape to cancel.',
    pickedUpIn:
      'Picked up {{ticket}} in {{column}}. Use the arrow keys to move it, Space to drop, Escape to cancel.',
    notOverColumn: '{{ticket}} is not over a column.',
    nextTo: '{{ticket}} is in {{column}}, next to {{other}}.',
    over: '{{ticket}} is over {{column}}.',
    notDropped: '{{ticket}} was not dropped on a column, so it stays in {{column}}.',
    stays: '{{ticket}} stays in {{column}}.',
    movedWithin: 'Moved {{ticket}} within {{column}}.',
    movedTo: 'Moved {{ticket}} to {{column}}.',
    // A WIP limit (#270): the same as a pointer sees.
    movedOver: 'Moved {{ticket}} to {{column}}. {{column}} is now over its limit, {{count}} of {{limit}}.',
    refused: '{{column}} is full, so {{ticket}} stays in {{from}}.',
    cancelled: 'Move cancelled. {{ticket}} stays in {{column}}.',
    /** Where a card with no column "stays" -- it should never happen. */
    itsColumn: 'its column',
  },
} as const

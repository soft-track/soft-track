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
  noIssues: 'No tickets',
  expandNamed_one: 'Expand {{name}}, {{count}} ticket',
  expandNamed_other: 'Expand {{name}}, {{count}} tickets',
  collapsedTitle: '{{name}} · {{count}}',
  /** An issue the board cannot name, in an announcement. */
  theIssue: 'The ticket',
  keyboard: {
    instructions:
      'To move this ticket, press Shift and Space to pick it up. The left and right arrow keys choose a column, up and down move it past the cards above and below, and Space drops it. Escape cancels. Enter opens the ticket, and Space on its own shows a preview of it.',
    pickedUp:
      'Picked up {{issue}}. Use the arrow keys to move it, Space to drop, Escape to cancel.',
    pickedUpIn:
      'Picked up {{issue}} in {{column}}. Use the arrow keys to move it, Space to drop, Escape to cancel.',
    notOverColumn: '{{issue}} is not over a column.',
    nextTo: '{{issue}} is in {{column}}, next to {{other}}.',
    over: '{{issue}} is over {{column}}.',
    notDropped: '{{issue}} was not dropped on a column, so it stays in {{column}}.',
    stays: '{{issue}} stays in {{column}}.',
    movedWithin: 'Moved {{issue}} within {{column}}.',
    movedTo: 'Moved {{issue}} to {{column}}.',
    cancelled: 'Move cancelled. {{issue}} stays in {{column}}.',
    /** Where a card with no column "stays" -- it should never happen. */
    itsColumn: 'its column',
  },
} as const

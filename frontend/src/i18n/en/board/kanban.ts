/** The kanban board: its columns, and what a screen reader hears while moving a card. */
export const kanban = {
  noProject: 'No project',
  pointsShort: '{{points}} pts',
  pointsTitle: '{{points}} points',
  pointsTitleUnsized_one: '{{points}} points, with {{count}} issue not yet sized',
  pointsTitleUnsized_other: '{{points}} points, with {{count}} issues not yet sized',
  collapseNamed: 'Collapse {{name}}',
  collapseColumn: 'Collapse column',
  dropHere: 'Drop here',
  noIssues: 'No issues',
  expandNamed_one: 'Expand {{name}}, {{count}} issue',
  expandNamed_other: 'Expand {{name}}, {{count}} issues',
  collapsedTitle: '{{name}} · {{count}}',
  /** An issue the board cannot name, in an announcement. */
  theIssue: 'The issue',
  keyboard: {
    instructions:
      'To move this issue, press Space to pick it up. The left and right arrow keys choose a column, up and down move it past the cards above and below, and Space drops it. Escape cancels. Enter opens the issue.',
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

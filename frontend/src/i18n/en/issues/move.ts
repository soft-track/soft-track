/** Moving an issue to another team: the dialog and the plan it shows. */
export const move = {
  title: 'Move {{identifier}} to another team',
  intro:
    'It keeps its comments, files, history and links. It gets a new key on the team it moves to.',
  moveTo: 'Move to',
  chooseTeam: 'Choose a team…',
  teamOption: '{{name}} ({{key}})',
  working: 'Working out what changes…',
  confirm: 'Move',
  confirmTo: 'Move to {{key}}',
  moving: 'Moving…',
  errors: {
    preview: 'Could not check that move.',
    move: 'Could not move the ticket.',
  },
  plan: {
    becomes: '{{from}} becomes {{to}}.',
    stays: 'Stays in {{status}}.',
    moves: 'Moves from {{from}} to {{to}}.',
    movesUnlike: 'Moves from {{from}} to {{to}} — that team has no column like it.',
    keeps: 'Keeps {{labels}}.',
    loses: 'Loses {{labels}} — no label by that name there.',
    leavesSprint: 'Leaves {{sprint}}; sprints belong to one team.',
    leavesProject: 'Leaves {{project}}; epics belong to one team.',
    unassigned: 'Is unassigned from {{name}}, who is not on that team.',
    detached: 'Stops being a sub-ticket of {{parent}}.',
    takes_one: 'Takes its sub-ticket {{list}} with it.',
    takes_other: 'Takes its sub-tickets {{list}} with it.',
  },
} as const

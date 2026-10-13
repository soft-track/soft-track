/** What a sprint is for, and what the team learned from it (#271). */
export const retro = {
  goal: 'Goal (optional)',
  goalPlaceholder: 'What is this sprint for? A sentence or two.',
  /** Whether the goal was met, as a chip. */
  outcome: {
    met: 'Goal met',
    partly: 'Goal partly met',
    missed: 'Goal missed',
  },
  /** The same, as a choice. */
  choice: {
    met: 'Met',
    partly: 'Partly',
    missed: 'Missed',
  },
  complete: {
    title: 'Complete {{name}}',
    points: '{{done}} of {{total}} points are done. Unfinished tickets move to the next sprint, or to the backlog.',
    tickets: '{{done}} of {{total}} tickets are done. Unfinished tickets move to the next sprint, or to the backlog.',
    question: 'Was the goal met?',
    retrospective: 'Retrospective',
    later: 'can be filled in later',
    submit: 'Complete sprint',
    completing: 'Completing…',
  },
  sections: {
    wentWell: 'What went well',
    didNot: 'What did not',
    toChange: 'What to change',
  },
  /** Short headings, in the retrospective itself. */
  headings: {
    wentWell: 'Went well',
    didNot: 'Did not',
    toChange: 'To change',
  },
  panel: {
    title: '{{name}} · retrospective',
    howDidItGo: 'How did the goal go?',
    empty: 'Nothing yet.',
    edit: 'Edit',
    save: 'Save',
    makeTicket: 'Make a ticket',
    making: 'Making…',
    close: 'Close retrospective',
    confirmClose: 'Close this retrospective? Nobody will be able to change it afterwards.',
    closed: 'Closed {{date}}',
    error: 'Could not save that.',
  },
  past: {
    title: 'Past sprints',
    hint: 'The next planning starts here.',
    points: '{{done}} of {{total}} pts',
    actions_one: '{{count}} action',
    actions_other: '{{count}} actions',
    noGoal: 'No goal was written',
  },
} as const

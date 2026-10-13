/** Project states, colours and progress, on the project page, the roadmap and the new project dialog. */
export const projects = {
  states: {
    planned: 'Planned',
    in_progress: 'In progress',
    completed: 'Completed',
    cancelled: 'Cancelled',
  },
  /** The swatches in the new project dialog, read aloud by name (#210). */
  colours: {
    indigo: 'Indigo',
    pink: 'Pink',
    teal: 'Teal',
    amber: 'Amber',
    violet: 'Violet',
    red: 'Red',
    green: 'Green',
  },
  progress: '{{completed}} of {{total}} done',
} as const

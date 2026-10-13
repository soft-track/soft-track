/** The sprints in the sidebar. */
export const list = {
  empty: 'No sprints yet.',
  /** A sprint's state, as the tooltip on its dot. */
  state: {
    active: 'active',
    upcoming: 'upcoming',
    completed: 'completed',
  },
  /** Points burned, then when the sprint ends. */
  pointsEnds: '{{completed}}/{{total}} pts · ends {{when}}',
  pointsEnded: '{{completed}}/{{total}} pts · ended {{when}}',
} as const

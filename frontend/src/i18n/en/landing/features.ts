/** The landing page's feature cards: a title and a paragraph each. */
export const features = {
  board: {
    title: 'A board and a list',
    body: 'Drag-and-drop kanban over statuses each team defines for itself, or the same issues as a dense sortable list. Filters are shareable, and worth saving as a view.',
  },
  cycles: {
    title: 'Cycles and estimates',
    body: 'Timeboxed cycles with points on issues, so a burndown has something real to burn down. Sub-issues and issue links for the work that does not fit in one card.',
  },
  reports: {
    title: 'Reports from real history',
    body: 'Burndown, velocity, cumulative flow and created-versus-resolved, all built from the recorded issue events rather than from whatever the board looks like today.',
  },
  notifications: {
    title: 'Notifications that batch',
    body: 'An in-app inbox, explicit watching that survives the next thing you do, and an optional email digest that gathers up what you have not already read.',
  },
  keyboard: {
    title: 'Built for the keyboard',
    body: 'A command palette, full-text search across issues and comments, and markdown with @mentions everywhere text is written.',
  },
  moving: {
    title: 'A way in and a way out',
    body: 'Import the Jira board you are leaving, attach files to issues and comments, and link branches and pull requests from GitHub or GitLab.',
  },
} as const

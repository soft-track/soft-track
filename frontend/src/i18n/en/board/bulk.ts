/** Board → the bar that appears while tickets are selected, and its errors. */
export const bulk = {
  toolbarLabel: 'Bulk actions',
  selected_one: '{{count}} selected',
  selected_other: '{{count}} selected',
  setStatus: 'Set status',
  statusPlaceholder: 'Status…',
  setPriority: 'Set priority',
  priorityPlaceholder: 'Priority…',
  setAssignee: 'Set assignee',
  assigneePlaceholder: 'Assignee…',
  unassigned: 'Unassigned',
  setProject: 'Set epic',
  projectPlaceholder: 'Epic…',
  noProject: 'No epic',
  setSprint: 'Set sprint',
  sprintPlaceholder: 'Sprint…',
  noSprint: 'No sprint',
  setLabels: 'Add or remove a label',
  labelsPlaceholder: 'Labels…',
  clearSelection: 'Clear selection',
  clearSelectionHint: 'Clear selection (Esc)',
  // Deleting moves to the trash (#323), from where it can be restored.
  confirmDelete_one:
    'Move this ticket to the trash? It leaves boards, lists, search and reports, and can be restored from the team’s trash, with its comments and attachments, until it is purged.',
  confirmDelete_other:
    'Move {{count}} tickets to the trash? They leave boards, lists, search and reports, and can be restored from the team’s trash, with their comments and attachments, until they are purged.',
  errors: {
    update: 'Could not update those tickets.',
    delete: 'Could not delete those tickets.',
  },
} as const

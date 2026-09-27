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
  confirmDelete_one:
    'Delete ticket? This cannot be undone. Comments and attachments are deleted with them; sub-tickets are kept and moved to the top level.',
  confirmDelete_other:
    'Delete {{count}} tickets? This cannot be undone. Comments and attachments are deleted with them; sub-tickets are kept and moved to the top level.',
  errors: {
    update: 'Could not update those tickets.',
    delete: 'Could not delete those tickets.',
  },
} as const

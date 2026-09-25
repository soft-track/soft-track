/** Board → the bar that appears while issues are selected, and its errors. */
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
  setProject: 'Set project',
  projectPlaceholder: 'Project…',
  noProject: 'No project',
  setCycle: 'Set cycle',
  cyclePlaceholder: 'Cycle…',
  noCycle: 'No cycle',
  setLabels: 'Add or remove a label',
  labelsPlaceholder: 'Labels…',
  clearSelection: 'Clear selection',
  clearSelectionHint: 'Clear selection (Esc)',
  confirmDelete_one:
    'Delete issue? This cannot be undone. Comments and attachments are deleted with them; sub-issues are kept and moved to the top level.',
  confirmDelete_other:
    'Delete {{count}} issues? This cannot be undone. Comments and attachments are deleted with them; sub-issues are kept and moved to the top level.',
  errors: {
    update: 'Could not update those issues.',
    delete: 'Could not delete those issues.',
  },
} as const

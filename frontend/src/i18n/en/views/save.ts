/** Views → the dialog that saves the board's filters as a view, or edits one. */
export const save = {
  titleNew: 'Save this view',
  titleEdit: 'Edit view',
  // Facets of the summary line, each shown after the filters with a " · ".
  grouped: 'grouped by project',
  sorted: {
    created: { asc: 'sorted by created, ascending', desc: 'sorted by created, descending' },
    updated: { asc: 'sorted by updated, ascending', desc: 'sorted by updated, descending' },
    priority: { asc: 'sorted by priority, ascending', desc: 'sorted by priority, descending' },
    estimate: { asc: 'sorted by estimate, ascending', desc: 'sorted by estimate, descending' },
    title: { asc: 'sorted by title, ascending', desc: 'sorted by title, descending' },
    rank: { asc: 'sorted by rank, ascending', desc: 'sorted by rank, descending' },
  },
  name: 'Name',
  namePlaceholder: 'Urgent bugs',
  share: 'Share with the team',
  shareHint:
    'Everyone on {{team}} sees it in their sidebar. Private otherwise — a link to these filters still works for anyone on the team.',
  submitNew: 'Save view',
  submitEdit: 'Save changes',
  errors: {
    save: 'Could not save that view.',
  },
} as const

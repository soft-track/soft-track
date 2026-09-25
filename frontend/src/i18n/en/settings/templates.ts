/** Settings → Team → Issue templates. */
export const templates = {
  title: 'Issue templates',
  intro:
    'Starting points for a new issue’s description on {{team}}. Choosing one in the new-issue form fills the description, and it can be edited freely from there.',
  emptyAdmin: 'No templates yet. A bug report with repro steps is the usual first one.',
  emptyMember: 'This team has no templates.',
  moveUp: 'Move {{name}} up',
  moveDown: 'Move {{name}} down',
  deleteNamed: 'Delete {{name}}',
  addTemplate: 'Add template',
  addATemplate: 'Add a template',
  adminsOnly: 'Only team admins can change the templates.',
  confirmDelete: 'Delete the “{{name}}” template? Issues filed from it keep their text.',
  form: {
    nameLabel: 'Name',
    namePlaceholder: 'Bug report',
    bodyLabel: 'Description (Markdown)',
    bodyPlaceholder: '## Steps to reproduce\n\n1. \n\n## Expected\n\n## Actual',
  },
  errors: {
    reorder: 'Could not reorder the templates.',
    delete: 'Could not delete that template.',
    save: 'Could not save that template.',
    add: 'Could not add that template.',
  },
} as const

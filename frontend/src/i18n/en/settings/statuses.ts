/** Settings → Team → Statuses. */
export const statuses = {
  title: 'Statuses',
  intro: 'The columns on {{team}}’s board, in order.',
  categories:
    'Every status belongs to one of five fixed <strong>categories</strong>. The category is what the tracker reads — whether a cycle is finished, whether a blocker still blocks, what counts as delivered on a burndown — so you can call a column anything and none of that has to learn its name. The five cannot be added to; that is the line between a workflow and a workflow engine.',
  nameOf: 'Name of {{name}}',
  categoryOf: 'Category of {{name}}',
  moveEarlier: 'Move {{name}} earlier',
  moveLater: 'Move {{name}} later',
  deleteNamed: 'Delete {{name}}',
  lastColumn: 'A team needs at least one column',
  nameLabel: 'Name',
  namePlaceholder: 'Blocked',
  meansLabel: 'Means',
  categoryOption: '{{label}} — {{hint}}',
  addStatus: 'Add a status',
  adminsOnly: 'Only team admins can change the board’s columns.',
  errors: {
    reorder: 'Could not reorder the columns.',
    add: 'Could not add that column.',
    rename: 'Could not rename that column.',
    recategorise: 'Could not change that category.',
    delete: 'Could not delete that column.',
  },
  deleteDialog: {
    title: 'Delete “{{name}}”',
    body: 'Any issues in it have to go somewhere. Nothing is deleted but the column.',
    moveTo: 'Move its issues to',
    confirm: 'Delete the column',
  },
} as const

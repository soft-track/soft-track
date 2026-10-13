/** Settings → a team → Labels (#321): rename, recolour, add and delete. */
export const labels = {
  title: 'Labels',
  intro: 'What {{team}} tags its tickets with. A label is this team’s own.',
  nameOf: 'Name of {{name}}',
  // The swatch's button: what it is now, and that it opens the palette.
  colourOf: 'Colour of {{name}}: {{colour}}',
  colourOfOwn: 'Colour of {{name}}: a colour of its own',
  palette: 'Colour',
  tickets_one: '{{count}} ticket',
  tickets_other: '{{count}} tickets',
  deleteNamed: 'Delete {{name}}',
  empty: 'No labels yet. Add one here, and it can go on any ticket on the team.',
  add: 'Add a label',
  newName: 'Name of the new label',
  newPlaceholder: 'Needs design',
  guestNote: 'Guests can see the team’s labels but not change them.',
  memberNote: 'Any member can add, rename and recolour a label. Team admins delete them.',
  delete: {
    title: 'Delete “{{name}}”?',
    carried_one:
      '<strong>{{count}} ticket</strong> carries it. Choose what happens to it.',
    carried_other:
      '<strong>{{count}} tickets</strong> carry it. Choose what happens to them.',
    notCarried: 'No ticket carries it.',
    merge: 'Merge into another label',
    mergeInto: 'The label to merge it into',
    remove_one: 'Remove it from the ticket',
    remove_other: 'Remove it from the tickets',
    removeUnused: 'Delete it',
    alsoNamed: 'Also named in',
    viewMerge: 'The saved view “{{name}}”, which will filter by {{target}}.',
    viewRemove: 'The saved view “{{name}}”, which will stop filtering by a label.',
    hiddenMerge_one: 'One private view of somebody else’s, which will filter by {{target}}.',
    hiddenMerge_other: '{{count}} private views of other people’s, which will filter by {{target}}.',
    hiddenRemove_one: 'One private view of somebody else’s, which will stop filtering by a label.',
    hiddenRemove_other:
      '{{count}} private views of other people’s, which will stop filtering by a label.',
    ruleMerge: 'The automation rule “{{name}}”, which will name {{target}} instead.',
    ruleRemove: 'The automation rule “{{name}}”, which will be switched off.',
    confirm: 'Delete label',
  },
  errors: {
    add: 'Could not add that label.',
    rename: 'Could not rename that label.',
    recolour: 'Could not change that colour.',
    delete: 'Could not delete that label.',
  },
} as const

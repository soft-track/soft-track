/** Importing tickets: the Jira import dialog, its dry-run report and its errors. */
export const imports = {
  jira: {
    title: 'Import from Jira',
    intro:
      'A Jira CSV or JSON export. Export with the <em>Issue key</em> column so the import can be re-run safely.',
    chooseFile: 'Choose a Jira export',
    fileSize: '{{size}} KB',
    fileHint: '.csv or .json, up to 20 MB',
    browse: 'Browse',
    // The report: first as a promise (the dry run), then as a receipt.
    wouldCreate: 'This import would create',
    imported: 'Imported',
    tickets_one: '<n>{{count}}</n> ticket',
    tickets_other: '<n>{{count}}</n> tickets',
    skipped_one: '· {{count}} already imported, left alone',
    skipped_other: '· {{count}} already imported, left alone',
    comments_one: '<n>{{count}}</n> comment',
    comments_other: '<n>{{count}}</n> comments',
    labels_one: '<n>{{count}}</n> new label',
    labels_other: '<n>{{count}}</n> new labels',
    projects_one: '<n>{{count}}</n> epic',
    projects_other: '<n>{{count}}</n> epics',
    // Made of the versions the issues name (#272, #273).
    releases_one: '<n>{{count}}</n> release',
    releases_other: '<n>{{count}}</n> releases',
    // Added to the team's list of where bugs are found (#273).
    environments_one: '<n>{{count}}</n> new environment',
    environments_other: '<n>{{count}}</n> new environments',
    // What was created, by name, after the count.
    names: '— {{names}}',
    unmatchedTitle: 'Not members of this team',
    unmatchedHint: 'Add them to the team first and re-run to attribute their work.',
    previewTitle: 'First {{shown}} of {{total}}',
    working: 'Working…',
    confirm_one: 'Import {{count}} ticket',
    confirm_other: 'Import {{count}} tickets',
    check: 'Check the file',
    errors: {
      read: 'That import could not be read.',
    },
  },
} as const

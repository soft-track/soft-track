// Releases (#272): the tab beside Reports, a release's page, releasing it,
// its notes, and where a fix version shows elsewhere.
export const releases = {
  /** The list on the left of the tab. */
  list: {
    heading: 'Releases',
    label: 'Releases',
    archived: 'Archived',
    /** A planned release with a target date: "15 Oct". */
    targetPattern: 'd MMM',
    released: 'released',
    planned: 'planned',
    newRelease: 'New release',
  },
  /** A team with no releases yet. */
  empty: {
    title: 'No releases yet',
    body: 'A release is a name for a set of tickets, like 1.4.0: it says which version a piece of work shipped in. Make one, then set it as a ticket’s fix version.',
    guest: 'This team has not made a release yet.',
  },
  states: {
    planned: 'Planned',
    released: 'Released',
    archived: 'Archived',
  },
  /** A release's page. */
  page: {
    /** "Target 15 Oct 2026." */
    target: 'Target {{date}}.',
    released: 'Released {{date}}.',
    datePattern: 'd MMM yyyy',
    notes: 'Release notes',
    release: 'Release',
    more: 'More actions for {{name}}',
    menu: 'Release actions',
    edit: 'Edit',
    archive: 'Archive',
    unarchive: 'Unarchive',
    reopen: 'Reopen',
    delete: 'Delete',
    confirmDelete:
      'Delete {{name}}? Its tickets keep everything else and ship in no release; views and rules that named it forget it.',
    loading: 'Loading the release…',
    error: 'The release could not be loaded.',
    actionError: 'That did not work. Try again.',
    progressLabel: 'Done in {{name}}',
    /** "11 of 16 pts". */
    points: '{{done}} of {{total}} pts',
    /** "3 of 5 tickets". */
    tickets_one: '{{done}} of {{count}} ticket',
    tickets_other: '{{done}} of {{count}} tickets',
    notDone: 'Not done yet',
    done: 'Done',
    cancelled: 'Cancelled',
    empty: 'Nothing ships in {{name}} yet. Set a ticket’s fix version to put it here.',
    allDone: 'Everything in {{name}} is done.',
  },
  /** Making or editing a release. */
  form: {
    newTitle: 'New release',
    editTitle: 'Edit {{name}}',
    name: 'Name',
    namePlaceholder: '1.4.0',
    description: 'Description',
    descriptionPlaceholder: 'What this version is for',
    target: 'Target date',
    create: 'Create release',
    creating: 'Creating…',
    save: 'Save',
    error: 'The release could not be saved.',
  },
  /** Releasing, which asks about the rest. */
  release: {
    title: 'Release {{name}}',
    releasedOn: 'Released on',
    unfinished_one: '<strong>{{count}} ticket</strong> in {{name}} is not done.',
    unfinished_other: '<strong>{{count}} tickets</strong> in {{name}} are not done.',
    allDone: 'Everything in {{name}} is done or cancelled.',
    move: 'Move them to the next release',
    moveTo: 'The release to move them to',
    leave: 'Leave them without a release',
    noNext: 'There is no other planned release to move them to.',
    submit: 'Release',
    releasing: 'Releasing…',
    error: 'The release could not be released.',
    /** The toast once it has gone. */
    done_one: '{{name}} released. {{count}} ticket moved to {{next}}.',
    done_other: '{{name}} released. {{count}} tickets moved to {{next}}.',
    doneLeft_one: '{{name}} released. {{count}} ticket left without a release.',
    doneLeft_other: '{{name}} released. {{count}} tickets left without a release.',
    doneAll: '{{name}} released.',
  },
  /** The drafted release notes. */
  notes: {
    title: 'Release notes · {{name}}',
    label: 'Release notes in markdown',
    hint: 'Drafted from the done tickets, stories then bugs then tasks. Edit it before you share it.',
    copy: 'Copy',
    copied: 'Copied',
    download: 'Download',
    loading: 'Drafting the notes…',
    error: 'The notes could not be drafted.',
  },
  /** A fix version on a ticket, and the board grouped by release. */
  ticket: {
    fixVersion: 'Fix version',
    /** What a bug calls its fix version (#273). */
    fixedIn: 'Fixed in',
    none: 'No release',
  },
  /** A release's marker on the roadmap: "1.4.0 · 15 Oct". */
  roadmap: {
    marker: '{{name}} · {{date}}',
    datePattern: 'd MMM',
    label_planned: '{{name}}, target {{date}}',
    label_released: '{{name}}, released {{date}}',
  },
} as const

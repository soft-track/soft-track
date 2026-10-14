/** Settings → Team → General. */
export const general = {
  title: 'General',
  introAdmin: 'What this team is called, and what it is for.',
  introMember: 'Only admins of this team can change these.',
  saved: 'Saved.',
  nameLabel: 'Name',
  descriptionLabel: 'Description',
  descriptionPlaceholder: 'What this team works on',
  keyLabel: 'Key',
  keyFixed:
    'Cannot be changed — identifiers like <code>{{key}}-42</code> are already in commit messages and chat logs.',
  saveChanges: 'Save changes',
  // Who can find the team (#259): the team directory, and joining without asking.
  findable: {
    heading: 'Who can find this team',
    listed: 'Listed in Teams',
    listedHint: 'People who are not members see the name, the key and the admins.',
    open: 'Open to join',
    openHint: 'Anybody signed in joins as a member without asking.',
  },
  // Whether the team's guests may comment (#244).
  guests: {
    heading: 'Guests',
    mayComment: 'Guests may comment',
    mayCommentHint:
      'Guests can write comments, attach files to them and react. They still change nothing else.',
    none: '{{team}} has no guests.',
    some_one: '{{team}} has 1 guest: {{names}}.',
    some_other: '{{team}} has {{count}} guests: {{names}}.',
  },
  // Who may delete tickets and epics (#323).
  deleting: {
    heading: 'Deleting',
    question: 'Who may delete tickets and epics',
    creatorAndAdmins: 'The creator and team admins',
    creatorAndAdminsHint: 'The default for a new team. An epic’s lead counts as its creator.',
    everyMember: 'Every member',
    everyMemberHint: 'What every team did before there was a trash.',
    note: 'Guests never delete. Deleted tickets and epics wait in the trash, where anybody on the team but a guest can restore them. Deleting and restoring are in the ticket’s history, and outbound webhooks get <code>ticket.deleted</code> and <code>ticket.restored</code>.',
  },
  // What the team estimates in (#268): points, hours or both.
  estimates: {
    heading: 'Estimates',
    question: 'This team estimates in',
    points: 'Points',
    pointsHint: 'The default. A team that leaves it sees no change.',
    hours: 'Hours',
    both: 'Both',
    bothHint: 'Points for size, hours for cost.',
  },
  // What each person can take in a sprint, before it is changed (#269).
  capacity: {
    heading: 'Capacity',
    intro:
      'What each person can take in a sprint, before it is changed for somebody on the Plan tab. Both shrink with the days somebody is away.',
    points: 'Points a sprint',
    hours: 'Hours a working day',
    save: 'Save',
    saved: 'Saved.',
  },
  // Where the team's bugs are found (#273).
  environments: {
    heading: 'Environments',
    intro:
      'Where a bug can be found. A bug’s environment is one of these; taking one off leaves it on the bugs that have it.',
    none: 'No environments. Bugs on this team are not asked where they were found.',
    new: 'A new environment',
    placeholder: 'Demo, Customer sandbox…',
    add: 'Add',
    remove: 'Remove {{name}}',
    taken: '{{name}} is in the list already.',
  },
  // Archiving a team, and deleting one that was a mistake (#322).
  archive: {
    heading: 'Archive',
    archiveTitle: 'Archive {{team}}',
    archiveHint:
      'Read-only, and out of the team switcher, pickers and search. Tickets, comments and history stay, and <code>{{key}}-42</code> keeps resolving.',
    archiveButton: 'Archive team…',
    unarchiveTitle: 'Unarchive {{team}}',
    unarchiveHint:
      'Archived {{date}}. Read-only until it is unarchived, which puts it back exactly as it was.',
    unarchiveButton: 'Unarchive team',
    unarchiving: 'Unarchiving…',
    datePattern: 'd MMM yyyy',
    deleteTitle: 'Delete {{team}}',
    deleteHint:
      'Only for a team with no tickets. {{team}} has {{count}}, so it is archived and not deleted.',
    deleteHintEmpty: 'Only for a team with no tickets. {{team}} has none, so it can be deleted.',
    deleteButton: 'Delete team',
    deleteConfirm: 'Delete {{team}}? It has no tickets, and this cannot be undone.',
    deleting: 'Deleting…',
    adminsOnly: 'Only an admin of this team, or a site admin, archives or deletes it.',
    dialog: {
      title: 'Archive {{team}}?',
      body_one:
        'The team becomes read-only for its {{count}} member. Nothing is deleted, and unarchiving puts it back exactly as it was.',
      body_other:
        'The team becomes read-only for its {{count}} members. Nothing is deleted, and unarchiving puts it back exactly as it was.',
      stops: 'These stop while it is archived',
      nothingStops: 'Nothing on this team runs on its own, so nothing stops.',
      automationRules_one: '{{count}} automation rule',
      automationRules_other: '{{count}} automation rules',
      webhooks_one: '{{count}} webhook',
      webhooks_other: '{{count}} webhooks',
      repositoryLinks_one: '{{count}} repository link',
      repositoryLinks_other: '{{count}} repository links',
      recurringTickets_one: '{{count}} recurring ticket',
      recurringTickets_other: '{{count}} recurring tickets',
      separator: ' · ',
      openTickets_one: '{{count}} open ticket stays open and assigned.',
      openTickets_other: '{{count}} open tickets stay open and assigned.',
      noOpenTickets: 'It has no open tickets.',
      loading: 'Counting what stops…',
      confirm: 'Archive team',
      archiving: 'Archiving…',
    },
  },
  errors: {
    archive: 'Could not archive this team.',
    unarchive: 'Could not unarchive this team.',
    delete: 'Could not delete this team.',
    preview: 'Could not count what archiving stops.',
    capacity: 'Could not change the capacity.',
    environments: 'Could not change the environments.',
    estimates: 'Could not change what this team estimates in.',
    save: 'Could not save this team.',
    deleting: 'Could not change who may delete.',
    guests: 'Could not change whether guests may comment.',
    findable: 'Could not change who can find this team.',
  },
} as const

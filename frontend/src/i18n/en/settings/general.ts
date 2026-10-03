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
  errors: {
    save: 'Could not save this team.',
    deleting: 'Could not change who may delete.',
    guests: 'Could not change whether guests may comment.',
  },
} as const

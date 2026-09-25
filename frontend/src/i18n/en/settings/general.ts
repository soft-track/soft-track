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
  errors: {
    save: 'Could not save this team.',
  },
} as const

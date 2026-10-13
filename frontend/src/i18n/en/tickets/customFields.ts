/** The team's own fields (#117), wherever a ticket shows or takes them. */
export const customFields = {
  heading: '{{team}} fields',
  kinds: {
    text: 'Text',
    number: 'Number',
    select: 'Select',
    multi_select: 'Multi-select',
    user: 'User',
    date: 'Date',
    checkbox: 'Checkbox',
    url: 'URL',
  },
  // The empty choice in a select or a person picker.
  none: 'None',
  nobody: 'Nobody',
  yes: 'Yes',
  requiredMark: 'required',
  editLink: 'Edit {{field}}',
  archivedHint: 'Archived: kept on the ticket, no longer changed.',
  otherTypeHint: 'Not a field on this type of ticket: kept here, no longer changed.',
  required_one: '<strong>{{fields}} is required</strong> on {{team}} tickets.',
  required_other: '<strong>{{fields}} are required</strong> on {{team}} tickets.',
  errors: {
    save: 'Could not save {{field}}.',
  },
} as const

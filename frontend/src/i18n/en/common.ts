/** Words every namespace uses. */
export const common = {
  cancel: 'Cancel',
  save: 'Save',
  saving: 'Saving…',
  delete: 'Delete',
  remove: 'Remove',
  edit: 'Edit',
  close: 'Close',
  add: 'Add',
  loading: 'Loading…',
  copy: 'Copy',
  copied: 'Copied',
  teamNotFound: 'That team does not exist, or you are not a member of it.',
  /** Two dates as a span: "8 Sept – 22 Sept". */
  dateRange: '{{start}} – {{end}}',
  /** Beside the name of somebody from outside the organisation (#243). */
  external: 'External',
  externalHint: 'From outside the organisation',
  /** Beside the name of an account nobody has signed into yet (#303). */
  notActivated: 'not yet activated',
  notActivatedHint: 'A site admin made this account. Its owner has not signed in yet.',
} as const

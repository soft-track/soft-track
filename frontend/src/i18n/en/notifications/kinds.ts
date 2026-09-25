/** Inbox → the line above each issue, one whole sentence per kind: with a person, and without. */
export const kinds = {
  assigned: {
    byActor: '{{actor}} assigned this to you',
    noActor: 'Assigned this to you',
  },
  mentioned: {
    byActor: '{{actor}} mentioned you',
    noActor: 'Mentioned you',
  },
  commented: {
    byActor: '{{actor}} commented',
    noActor: 'Commented',
  },
  status_changed: {
    byActor: '{{actor}} changed the status',
    noActor: 'Changed the status',
  },
} as const

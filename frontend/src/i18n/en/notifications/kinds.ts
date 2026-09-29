/** Inbox → the line above each ticket, one whole sentence per kind: with a person, and without. */
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
  // Named in one of the team's own user fields (#117): a reviewer, say.
  field_assigned: {
    byActor: '{{actor}} set you as {{field}}',
    noActor: 'Set you as {{field}}',
  },
} as const

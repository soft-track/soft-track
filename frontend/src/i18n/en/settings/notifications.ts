/** Settings → Account → Notifications. */
export const notifications = {
  title: 'Notifications',
  intro: 'What reaches you, and where.',
  // The columns of the grid, one per channel.
  channels: {
    app: 'In the app',
    email: 'By email',
  },
  // The rows, by the kind's key. A kind registered on the server without an
  // entry here shows the English name and description it registered with.
  kinds: {
    assigned: {
      name: 'Assigned to you',
      description: 'A ticket becomes yours.',
    },
    mentioned: {
      name: 'Mentioned',
      description: 'Somebody writes @you.',
    },
    commented: {
      name: 'A comment on a ticket you watch',
      description: '',
    },
    status_changed: {
      name: 'A status change on a ticket you watch',
      description: '',
    },
    due_tomorrow: {
      name: 'Due tomorrow',
      description: 'The day before a due date.',
    },
    overdue: {
      name: 'Overdue',
      description: 'The day after, and once more a week later.',
    },
  },
  // In place of a switch for a kind that cannot be turned off in the app.
  always: 'always',
  alwaysHint: 'Always on: the inbox is how the tracker reaches you at all.',
  // The accessible name of one switch: "Mentioned, by email".
  switchLabel: '{{kind}}, {{channel}}',
  noMailServer: 'This SoftTrack has no mail server configured, so there is no email column.',
  teams: {
    heading: 'Teams',
    on: 'Everything the grid above allows.',
    muted: 'Muted: nothing from it except assignments and mentions.',
  },
  errors: {
    save: 'Could not save that.',
  },
} as const

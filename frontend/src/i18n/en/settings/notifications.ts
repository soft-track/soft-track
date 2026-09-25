/** Settings → Account → Notifications. */
export const notifications = {
  title: 'Notifications',
  intro: 'What reaches you, and where.',
  inApp: {
    heading: 'In the app',
    body: 'You are told when an issue is assigned to you, when someone mentions you, and when an issue you are watching gets a comment or changes status. You watch an issue automatically once you create it, comment on it, or are assigned it — and the Watch button on any issue overrides that either way.',
    alwaysOn: 'This cannot be turned off; the inbox is how the tracker reaches you at all.',
  },
  email: {
    heading: 'By email',
    digest: 'Send me a digest',
    digestHint:
      'One email gathering up anything you have not already read. Nothing is sent while you are keeping up with the inbox yourself.',
    destination: 'Digests go to the address on your profile.',
    notConfigured:
      'This SoftTrack has no mail server configured, so nothing is sent by email. An administrator can set <code>SMTP_HOST</code> to turn digests on.',
  },
  errors: {
    save: 'Could not save that.',
  },
} as const

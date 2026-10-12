/** Settings → Account → Security → Sessions (#308). */
export const sessions = {
  title: 'Sessions',
  intro:
    'Where your account is signed in. API tokens are not sessions, and stay in their own list.',
  /** "Firefox on Linux". Browser and system names are not translated. */
  label: '{{browser}} on {{system}}',
  labelBrowserOnly: '{{browser}}',
  labelSystemOnly: 'A browser on {{system}}',
  labelUnknown: 'An unknown browser',
  thisDevice: 'this device',
  began: 'began {{date}}',
  lastUsed: 'last used {{when}}',
  lastUsedNow: 'last used now',
  revoke: 'Revoke',
  revokeLabel: 'Revoke {{name}}',
  errors: {
    load: 'Could not load your sessions.',
    revoke: 'Could not revoke that session.',
  },
} as const

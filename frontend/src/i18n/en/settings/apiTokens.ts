/** Settings → Account → API tokens. */
export const apiTokens = {
  title: 'API tokens',
  intro:
    'For scripts and integrations. A token acts as you, with your access, sent as <code>Authorization: Bearer softtrack_…</code>. It cannot manage tokens or change your password — those need you signed in.',
  nameLabel: 'Name',
  namePlaceholder: 'Nightly export',
  expiresLabel: 'Expires',
  expiry: {
    days30: '30 days',
    days90: '90 days',
    year: 'A year',
    never: 'Never',
  },
  create: 'Create token',
  creating: 'Creating…',
  copyNow: 'Copy <strong>{{name}}</strong> now. It will not be shown again.',
  created: 'Created {{when}}',
  lastUsed: 'last used {{when}}',
  neverUsed: 'never used',
  expires: 'expires {{when}}',
  noExpiry: 'does not expire',
  revoke: 'Revoke',
  confirmRevoke: 'Revoke “{{name}}”? Anything using it stops working at once.',
  errors: {
    create: 'Could not create that token.',
    revoke: 'Could not revoke that token.',
    clipboard: 'Could not reach the clipboard. Select the token and copy it by hand.',
  },
} as const

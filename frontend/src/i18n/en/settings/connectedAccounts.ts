/** Settings → Account → Connected accounts. */
export const connectedAccounts = {
  title: 'Connected accounts',
  intro:
    'Sign in without a password. Connecting one attaches it to this account — it does not have to use the same email address.',
  linked: '{{provider}} connected.',
  notConnected: 'Not connected',
  lastUsed: 'last used {{when}}',
  useAnother: 'Use another',
  disconnect: 'Disconnect',
  connect: 'Connect',
  confirmDisconnect: 'Disconnect {{provider}}? You will no longer be able to sign in with it.',
  errors: {
    connect: 'Could not start that connection.',
    disconnect: 'Could not disconnect that account.',
  },
} as const

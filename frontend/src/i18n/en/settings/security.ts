/** Settings → Account → Security. */
export const security = {
  title: 'Security',
  intro: 'Changing your password signs out every other session.',
  introFirstPassword:
    'This account signs in with a provider and has no password. Setting one adds email and password as a second way in — useful if that provider is ever switched off here.',
  currentPassword: 'Current password',
  newPassword: 'New password',
  newPasswordPlaceholder: 'At least 8 characters',
  confirmPassword: 'Confirm new password',
  setPassword: 'Set password',
  changePassword: 'Change password',
  notices: {
    passwordSet: 'Password set. You can now sign in with your email address too.',
    passwordChanged: 'Password changed. Every other session has been signed out.',
    signedOutEverywhere: 'Signed out everywhere else.',
  },
  errors: {
    mismatch: 'The two new passwords do not match.',
    change: 'Could not change your password.',
    signOutEverywhere: 'Could not sign out the other sessions.',
  },
  signOutEverywhere: {
    title: 'Sign out everywhere',
    body: 'Ends every session on every other browser and device — a laptop left at the office, a phone you no longer have. You stay signed in here. API tokens are not sessions and keep working; revoke those above.',
    confirm: 'Sign out of every other browser and device? You will stay signed in here.',
    button: 'Sign out everywhere',
    pending: 'Signing out…',
  },
} as const

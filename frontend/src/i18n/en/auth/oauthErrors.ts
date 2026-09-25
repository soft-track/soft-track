/** Why a sign-in or connect with a provider failed, on /login and Settings → Security. */
export const oauthErrors = {
  cancelled: 'Sign-in was cancelled.',
  state:
    'That sign-in expired or could not be verified. Check that cookies are enabled, then try again.',
  account_exists:
    'An account already exists for that email address. Sign in with your password, then connect the provider from Settings → Security.',
  email_unverified:
    'Your provider has not verified that email address, so it cannot be used to sign in here. Verify it with them and try again.',
  no_email:
    'Your provider did not share an email address. Add a verified one to that account, or sign in with a password.',
  closed: 'This SoftTrack is invite-only, and there is no invitation waiting for that address.',
  deactivated: 'This account has been deactivated.',
  connect_required:
    'An account here already uses that email address, and it signs in a different way. Sign in the way it was set up, then connect this from Settings → Security.',
  throttled: 'Too many attempts from here. Wait a minute and try again.',
  unavailable: 'That sign-in provider is not enabled on this SoftTrack.',
  storage:
    'This browser is not letting SoftTrack store anything, which the sign-in needs. Check that cookies and site data are enabled, then try again.',
  already_connected: 'That provider account already signs in to a different SoftTrack account.',
  link_expired: 'That request expired. Try connecting again.',
  exchange_failed: 'The provider refused the sign-in. Please try again.',
  profile_failed: 'The provider did not say who you are. Please try again.',
  fallback: 'Could not finish signing in. Please try again.',
} as const

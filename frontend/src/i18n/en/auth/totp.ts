/** The second step of signing in, for an account with two-factor on. */
export const totp = {
  title: 'Two-factor authentication',
  hint: 'Enter the 6-digit code from your authenticator app, or one of your recovery codes.',
  label: 'Authentication code',
  submit: 'Verify',
  submitting: 'Verifying…',
  back: 'Start over',
  errors: {
    failed: 'That code did not work. Try again.',
  },
} as const

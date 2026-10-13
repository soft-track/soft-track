/** Asking for a password reset link, /forgot-password. */
export const forgotPassword = {
  title: 'Reset your password',
  intro: "We'll email you a link to choose a new one.",
  sent: 'If <strong>{{email}}</strong> has an account here, a reset link is on its way. It works once, for the next hour.',
  nothingArrived: 'Nothing arrived? Check your spam folder, or ask again in a few minutes.',
  submit: 'Send reset link',
  submitting: 'Sending…',
  backToSignIn: 'Back to sign in',
  errors: {
    failed: 'Could not send a reset link. Try again shortly.',
  },
} as const

/** The sign-up page, /register, with or without an invitation. */
export const register = {
  title: 'Create your <accent>account</accent>',
  invited: '{{inviter}} invited you to {{team}}.',
  closedTagline: 'This instance is closed to open sign-ups.',
  tagline: 'Free, self-hosted, no credit card.',
  locked: {
    title: 'This SoftTrack is invite-only',
    body: 'New accounts can only be created from an invitation link. Ask an administrator to send you one.',
  },
  fullName: 'Full name',
  fullNamePlaceholder: 'Ada Lovelace',
  invitedEmailHint: 'The address this invitation was sent to.',
  username: 'Username <optional>(optional)</optional>',
  usernamePlaceholder: 'Leave blank for the part before the @',
  passwordPlaceholder: 'At least 8 characters',
  submit: 'Create account',
  submitting: 'Creating account…',
  haveAccount: 'Already have an account? <signin>Sign in</signin>',
  errors: {
    failed: 'Could not create your account.',
  },
} as const

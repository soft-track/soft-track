/** Choosing a new password from an emailed link, /reset-password. */
export const resetPassword = {
  title: 'Choose a new password',
  done: "Your password has been changed, and you've been signed out everywhere you were signed in.",
  signIn: 'Sign in',
  noToken: 'This page needs the link from your reset email. <ask>Ask for one</ask>.',
  askForNewLink: 'Ask for a new link',
  newPassword: 'New password',
  minLength_one: 'At least {{count}} character.',
  minLength_other: 'At least {{count}} characters.',
  confirmPassword: 'Confirm new password',
  submit: 'Set new password',
  errors: {
    mismatch: 'The two passwords do not match.',
    failed: 'Could not reset your password.',
  },
} as const

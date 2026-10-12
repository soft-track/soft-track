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

/** Choosing a first password for an account a site admin made, /welcome (#303). */
export const welcome = {
  title: 'Choose a password',
  intro: 'An account was made for you. Choose a password to sign in.',
  done: 'Your password is set. Sign in with your email and the password you chose.',
  signIn: 'Sign in',
  noToken: 'This page needs the link from the email that told you about your account. Ask whoever made it for a new one.',
  invalid: 'This link is invalid or has expired. Ask whoever made your account to send it again.',
  password: 'Password',
  confirmPassword: 'Confirm password',
  submit: 'Set password',
} as const

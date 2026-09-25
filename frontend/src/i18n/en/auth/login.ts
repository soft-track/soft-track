/** The sign-in page, /login. */
export const login = {
  title: 'Sign in to <brand>SoftTrack</brand>',
  tagline: 'An open-source issue tracker for small teams.',
  forgotPassword: 'Forgot password?',
  submit: 'Sign in',
  submitting: 'Signing in…',
  demo: 'Demo login: {{email}} / {{password}}',
  noAccount: "Don't have an account? <signup>Create one</signup>",
  errors: {
    failed: 'Incorrect email or password.',
  },
} as const

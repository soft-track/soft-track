/** Settings → Account → Profile. */
export const profile = {
  title: 'Profile',
  intro: 'How you appear to everyone else on this SoftTrack.',
  saved: 'Saved.',
  fullName: 'Full name',
  username: 'Username',
  usernameHint:
    '2–39 characters. Letters, digits, dots, dashes and underscores. This is what <handle>@{{username}}</handle> resolves to in comments.',
  usernameFallback: 'you',
  avatarColour: 'Avatar colour',
  useColour: 'Use {{color}}',
  email: 'Email',
  currentPassword: 'Current password',
  currentPasswordPlaceholder: 'Confirm it is you',
  currentPasswordHint:
    'Your email is the address a password reset would go to, so changing it needs your password.',
  saveChanges: 'Save changes',
  errors: {
    save: 'Could not save your profile.',
  },
} as const

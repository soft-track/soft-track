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
  jobTitle: 'Job title <optional>· optional</optional>',
  jobTitlePlaceholder: 'e.g. Backend Engineer',
  location: 'Location <optional>· optional</optional>',
  locationPlaceholder: 'e.g. Lisbon, or Remote',
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
  /** The facts a site admin sets (#122), read-only under the form. */
  organisation: {
    title: 'Your place in the organisation',
    intro: 'Set by a site admin. Ask one if something here is wrong.',
    startDate: 'Start date',
    notSet: 'Not set',
  },
} as const

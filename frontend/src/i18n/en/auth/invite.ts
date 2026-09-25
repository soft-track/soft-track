/** The landing page for an invitation link, /invite/:token. */
export const invite = {
  checking: 'Checking your invitation…',
  invalid: {
    title: 'This invitation is no longer valid',
    body: 'It may have been used, revoked, or simply run out. Ask whoever invited you to send a fresh link.',
    signIn: 'Go to sign in',
  },
  eyebrow: 'Invitation',
  title: '{{inviter}} invited you to join <team>{{team}}</team>',
  // No spaces: the row is a flex container whose gap spaces the three items.
  teamAs: '<chip>{{teamKey}}</chip><as>as</as><role />',
  guest:
    'A guest can see the team’s issues, comments, cycles and reports, and change none of them.',
  sentTo: 'Sent to <strong>{{email}}</strong>.',
  createAccount: 'Create an account',
  signInToAccept: 'Sign in to accept',
  wrongAccount:
    'You are signed in as <strong>{{current}}</strong>, and this invitation was sent to <strong>{{invited}}</strong>. An invitation only admits the address it was addressed to.',
  switchAccount: 'Sign out and use the other account',
  join: 'Join {{team}}',
  joining: 'Joining…',
  decline: 'Decline',
  errors: {
    accept: 'Could not accept this invitation.',
    decline: 'Could not decline this invitation.',
  },
} as const

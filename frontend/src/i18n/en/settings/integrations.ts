/** Settings → Team → Repositories. */
export const integrations = {
  title: 'Repositories',
  adminsOnly:
    'Connecting a repository is a team admin’s job — this page shows webhook secrets, so it is not readable by the whole team. The branches and pull requests themselves show up on the issues, for everybody.',
  intro: 'Connect {{team}}’s code so its issues know about it.',
  howItWorks:
    'Put <issue>{{key}}-42</issue> in a branch name, a commit message or a pull request title, and that branch, commit or pull request shows up on issue {{key}}-42. Nothing else to fill in — the connection is already in the text you were going to write.',
  automation:
    'To move the issue as well — to In\u00a0Review when the pull request opens, to Done when it merges — write an <rule>automation rule</rule> with one of the repository triggers.',
  privacy:
    'SoftTrack never clones your code and holds no access token. It is sent webhooks, verifies their signature, and reads the text.',
  empty: 'No repositories connected yet.',
  providerLabel: 'Provider',
  repositoryLabel: 'Repository',
  connect: 'Connect',
  connectRepository: 'Connect a repository',
  lastDelivery: 'last delivery {{when}}',
  noDeliveries: 'no deliveries yet',
  payloadUrl: 'Payload URL',
  rotate: 'Rotate',
  rotateHint: 'Issues a new secret and a new URL. Both have to be updated at the provider.',
  disconnect: 'Disconnect',
  confirmDisconnect: 'Disconnect and remove its links',
  providers: {
    github: {
      placeholder: 'acme/api',
      secretField: 'Secret',
      where: 'Settings → Webhooks → Add webhook',
      setup:
        'Add these under {{provider}} → {{where}}, with content type application/json and the push and pull request events.',
    },
    gitlab: {
      placeholder: 'acme/api',
      secretField: 'Secret token',
      where: 'Settings → Webhooks',
      setup: 'Add these under {{provider}} → {{where}}, with the push and merge request events.',
    },
  },
  copyable: {
    show: 'Show the {{label}}',
    hide: 'Hide the {{label}}',
    copy: 'Copy the {{label}}',
  },
  errors: {
    connect: 'Could not connect that repository.',
    rotate: 'Could not rotate that secret.',
    disconnect: 'Could not disconnect that repository.',
  },
} as const

/** Issue panel → Development: the branches, pull requests and commits linked to an issue. */
export const development = {
  title: 'Development',
  groups: {
    pull_requests: 'Pull requests',
    branches: 'Branches',
    commits: 'Commits',
  },
  state: {
    open: 'Open',
    merged: 'Merged',
    closed: 'Closed',
  },
  // `provider` is a product name, GitHub or GitLab, and stays as it is.
  openOn: '{{repository}} — open on {{provider}}',
} as const

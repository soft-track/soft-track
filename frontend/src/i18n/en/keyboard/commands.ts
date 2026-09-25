/** Command palette → what it can do from the board, and the groups the commands sit under. */
export const commands = {
  groups: {
    actions: 'Actions',
    teams: 'Teams',
    account: 'Account',
  },
  newIssue: 'Create an issue',
  switchToList: 'Switch to list view',
  switchToBoard: 'Switch to board view',
  showShortcuts: 'Show keyboard shortcuts',
  switchTeam: 'Switch to {{team}}',
  openSettings: 'Open settings',
  manageMembers: 'Manage team members',
  siteAdmin: 'Site administration',
} as const

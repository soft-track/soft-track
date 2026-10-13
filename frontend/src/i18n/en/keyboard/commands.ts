/** Command palette → what it can do from the board, and the groups the commands sit under. */
export const commands = {
  groups: {
    actions: 'Actions',
    teams: 'Teams',
    account: 'Account',
  },
  newTicket: 'Create a ticket',
  newProject: 'Create an epic',
  switchToList: 'Switch to list view',
  switchToBoard: 'Switch to board view',
  showShortcuts: 'Show keyboard shortcuts',
  myWork: 'Go to My work',
  switchTeam: 'Switch to {{team}}',
  openSettings: 'Open settings',
  manageMembers: 'Manage team members',
  siteAdmin: 'Site administration',
} as const

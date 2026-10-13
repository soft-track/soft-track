/** Settings → Administration → Settings: the instance's own (#306). */
export const instance = {
  teams: {
    title: 'Teams',
    siteAdmin: 'Site admin',
    intro: 'Who may create a team on this SoftTrack. A team takes a key, and a key is never given back.',
    question: 'Who may create a team',
    anyone: 'Anyone signed in',
    anyoneHint: 'The default, and how it has always been.',
    siteAdmins: 'Site admins only',
    namedPeople: 'Named people',
    add: 'Add',
    addLabel: 'Add somebody who may create teams',
    searchPeople: 'Search people',
    nobodyNamed: 'Nobody named',
    remove: 'Take {{name}} off',
    environment: 'Also settable as <code>TEAM_CREATION</code> in the environment, which wins.',
    environmentSet:
      'Set as <code>TEAM_CREATION</code> in the environment, which wins: change it there. The named people are still chosen here.',
  },
  requests: {
    heading: 'Asked for · {{count}}',
    asks: '<strong>{{name}}</strong> asks for <strong>{{team}}</strong> <key>{{key}}</key>',
    reason: '“{{reason}}” · {{when}}',
    approve: 'Approve',
    decline: 'Decline…',
    approved: '{{team}} is created, with {{name}} as its admin.',
    declineDialog: {
      title: 'Decline {{team}}?',
      body: '{{name}} is told by email, with the reason if you give one.',
      reason: 'Why, for {{name}} (optional)',
      confirm: 'Decline',
    },
  },
  errors: {
    load: 'Could not load the settings.',
    save: 'Could not save the setting.',
    approve: 'Could not approve the request.',
    decline: 'Could not decline the request.',
  },
} as const

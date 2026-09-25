/** Issue panel → Activity: one line per recorded change (#81), each a whole sentence. */
export const history = {
  automation: 'Automation',
  status: '<actor>{{actor}}</actor> moved this from {{from}} to {{to}}',
  priority: {
    set: '<actor>{{actor}}</actor> set the priority to {{to}}',
    changed: '<actor>{{actor}}</actor> changed the priority from {{from}} to {{to}}',
    removed: '<actor>{{actor}}</actor> removed the priority (was {{from}})',
  },
  estimate: {
    set: '<actor>{{actor}}</actor> estimated this at {{to}}',
    changed: '<actor>{{actor}}</actor> changed the estimate from {{from}} to {{to}}',
    cleared: '<actor>{{actor}}</actor> cleared the estimate (was {{from}})',
  },
  points_one: '{{count}} point',
  points_other: '{{count}} points',
  assignee: {
    assigned: '<actor>{{actor}}</actor> assigned this to {{to}}',
    reassigned: '<actor>{{actor}}</actor> reassigned this from {{from}} to {{to}}',
    unassigned: '<actor>{{actor}}</actor> unassigned {{from}}',
  },
  cycle: {
    added: '<actor>{{actor}}</actor> added this to {{to}}',
    moved: '<actor>{{actor}}</actor> moved this from {{from}} to {{to}}',
    removed: '<actor>{{actor}}</actor> moved this out of {{from}}, back to the backlog',
  },
  due: {
    set: '<actor>{{actor}}</actor> set the due date to {{to}}',
    moved: '<actor>{{actor}}</actor> moved the due date from {{from}} to {{to}}',
    removed: '<actor>{{actor}}</actor> removed the due date (was {{from}})',
  },
  project: {
    added: '<actor>{{actor}}</actor> added this to {{to}}',
    moved: '<actor>{{actor}}</actor> moved this from {{from}} to {{to}}',
    removed: '<actor>{{actor}}</actor> removed this from {{from}}',
  },
  team: '<actor>{{actor}}</actor> moved this from {{from}} to {{to}}',
  other: '<actor>{{actor}}</actor> changed this',
  formerMember: 'a former member',
  deletedCycle: 'a deleted cycle',
  deletedProject: 'a deleted project',
  anotherTeam: 'another team',
  unknownStatus: 'an unknown status',
  noPriority: 'none',
} as const

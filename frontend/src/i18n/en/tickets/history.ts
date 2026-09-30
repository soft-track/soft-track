/** Ticket panel → Activity: one line per recorded change (#81), each a whole sentence. */
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
  sprint: {
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
  // One of the team's own fields (#117), by the name it has now.
  field: {
    set: '<actor>{{actor}}</actor> set {{field}} to {{to}}',
    changed: '<actor>{{actor}}</actor> changed {{field}} from {{from}} to {{to}}',
    cleared: '<actor>{{actor}}</actor> cleared {{field}} (was {{from}})',
    ticked: '<actor>{{actor}}</actor> ticked {{field}}',
    unticked: '<actor>{{actor}}</actor> unticked {{field}}',
  },
  // Moved into the trash and restored from it (#323).
  trash: {
    deleted: '<actor>{{actor}}</actor> moved this to the trash',
    restored: '<actor>{{actor}}</actor> restored this from the trash',
  },
  other: '<actor>{{actor}}</actor> changed this',
  formerMember: 'a former member',
  deletedSprint: 'a deleted sprint',
  deletedProject: 'a deleted epic',
  removedOption: 'a removed option',
  anotherTeam: 'another team',
  unknownStatus: 'an unknown status',
  noPriority: 'none',
} as const

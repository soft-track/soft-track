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
  // The time estimate, and what is left when somebody says so (#268).
  timeEstimate: {
    set: '<actor>{{actor}}</actor> set the time estimate to {{to}}',
    changed: '<actor>{{actor}}</actor> changed the time estimate from {{from}} to {{to}}',
    cleared: '<actor>{{actor}}</actor> cleared the time estimate (was {{from}})',
  },
  remaining: {
    set: '<actor>{{actor}}</actor> said {{to}} is left',
    cleared: '<actor>{{actor}}</actor> left what is left to be worked out (was {{from}})',
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
  // The release it ships in (#272).
  fixVersion: {
    set: '<actor>{{actor}}</actor> set the fix version to {{to}}',
    moved: '<actor>{{actor}}</actor> moved this from {{from}} to {{to}}',
    cleared: '<actor>{{actor}}</actor> took this out of {{from}}',
  },
  // A bug's details (#273).
  severity: {
    set: '<actor>{{actor}}</actor> rated this {{to}}',
    changed: '<actor>{{actor}}</actor> changed the severity from {{from}} to {{to}}',
    cleared: '<actor>{{actor}}</actor> removed the severity (was {{from}})',
  },
  environment: {
    set: '<actor>{{actor}}</actor> said this happens in {{to}}',
    changed: '<actor>{{actor}}</actor> changed the environment from {{from}} to {{to}}',
    cleared: '<actor>{{actor}}</actor> removed the environment (was {{from}})',
  },
  foundIn: {
    set: '<actor>{{actor}}</actor> said this was found in {{to}}',
    changed: '<actor>{{actor}}</actor> changed where this was found from {{from}} to {{to}}',
    cleared: '<actor>{{actor}}</actor> removed where this was found (was {{from}})',
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
  // A test result on the bug it raised (#275).
  testResult: {
    raised: '<actor>{{actor}}</actor> raised this from a failure of {{identifier}} in {{run}}',
    result: '<actor>{{actor}}</actor> marked {{identifier}} {{result}} in {{run}}',
    /** A result in the middle of that sentence. */
    results: {
      passed: 'passed',
      failed: 'failed',
      blocked: 'blocked',
      skipped: 'skipped',
      not_run: 'not run',
    },
  },
  // How a ticket a schedule made begins (#264): nobody did it.
  schedule: 'Created by the schedule <actor>{{name}}</actor>',
  other: '<actor>{{actor}}</actor> changed this',
  formerMember: 'a former member',
  deletedSprint: 'a deleted sprint',
  deletedProject: 'a deleted epic',
  deletedRelease: 'a deleted release',
  removedOption: 'a removed option',
  anotherTeam: 'another team',
  unknownStatus: 'an unknown status',
  noPriority: 'none',
} as const

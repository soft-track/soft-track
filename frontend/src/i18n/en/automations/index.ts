/** Automation rules read back in words: triggers, and one clause per condition and action. */
export const automations = {
  // Clauses rather than sentences: settings/automation slots them into its
  // "When {{trigger}}, if {{conditions}}, {{actions}}." templates.
  trigger: {
    issue_created: 'a ticket is created',
    status_changed: 'a ticket changes status',
    issue_assigned: 'a ticket is assigned',
    comment_added: 'a comment is added',
    sprint_completed: 'a sprint is completed',
    branch_created: 'a branch for it appears',
    pull_request_opened: 'a pull request for it opens',
    pull_request_merged: 'a pull request for it merges',
  },
  /**
   * Priorities as they read in the middle of a clause -- "its priority is
   * urgent". Their own words rather than the capitalised labels lower-cased,
   * which would be wrong in a language that capitalises nouns.
   */
  priorityInClause: {
    urgent: 'urgent',
    high: 'high',
    medium: 'medium',
    low: 'low',
    no_priority: 'no priority',
  },
  condition: {
    inStatus: 'it is in {{status}}',
    priority: 'its priority is {{priority}}',
    hasLabel: 'it has the label {{label}}',
    inProject: 'it is in {{project}}',
    unassigned: 'nobody is assigned',
    assignedTo: 'it is assigned to {{name}}',
  },
  action: {
    setStatus: 'set its status to {{status}}',
    setPriority: 'set its priority to {{priority}}',
    assignTo: 'assign it to {{name}}',
    addLabel: 'add the label {{label}}',
    moveToActiveSprint: 'move it to the active sprint',
    moveToSprint: 'move it to {{sprint}}',
    postComment: 'post a comment',
  },
  // Standing in for a name whose row has gone.
  missing: {
    status: 'a deleted status',
    label: 'a deleted label',
    project: 'a deleted epic',
    person: 'someone who has left',
    sprint: 'a deleted sprint',
  },
  // The whole rule as one sentence (describeRule).
  rule: {
    then: 'When {{trigger}}, {{actions}}.',
    ifThen: 'When {{trigger}}, if {{conditions}}, {{actions}}.',
    empty: 'When {{trigger}}, do nothing — this rule is empty.',
    ifEmpty: 'When {{trigger}}, if {{conditions}}, do nothing — this rule is empty.',
  },
} as const

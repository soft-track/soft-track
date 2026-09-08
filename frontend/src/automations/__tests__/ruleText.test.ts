import { describe, expect, it } from 'vitest'

import type {
  AutomationRuleRead,
  CycleRead,
  LabelRead,
  ProjectRead,
  StatusRead,
  TeamMemberRead,
} from '@/api/generated/models'
import {
  describeActions,
  describeConditions,
  describeRule,
  joinClauses,
} from '@/automations/ruleText'

const vocabulary = {
  statuses: [
    { id: 9, name: 'In Review' },
    { id: 4, name: 'Todo' },
  ] as unknown as StatusRead[],
  labels: [{ id: 3, team_id: 1, name: 'bug', color: '#f00' }] as LabelRead[],
  projects: [{ id: 2, team_id: 1, name: 'Platform' }] as unknown as ProjectRead[],
  members: [
    { user: { id: 7, full_name: 'Sam Rivera' }, role: 'member', joined_at: '' },
  ] as unknown as TeamMemberRead[],
  cycles: [{ id: 5, display_name: 'Sprint 3' }] as unknown as CycleRead[],
}

function rule(overrides: Partial<AutomationRuleRead> = {}): AutomationRuleRead {
  return {
    id: 1,
    team_id: 1,
    name: 'A rule',
    trigger: 'issue_created',
    is_enabled: true,
    conditions: { if_unassigned: false },
    actions: { move_to_active_cycle: false },
    created_by: { id: 7, full_name: 'Sam Rivera' },
    created_at: '',
    updated_at: '',
    ...overrides,
  } as unknown as AutomationRuleRead
}

describe('describeConditions', () => {
  it('names every condition the rule states and leaves the rest out', () => {
    const clauses = describeConditions(
      {
        if_status_id: 9,
        if_priority: 'urgent',
        if_label_id: 3,
        if_project_id: 2,
        if_assignee_id: 7,
        if_unassigned: false,
      },
      vocabulary,
    )
    expect(clauses).toEqual([
      'it is in In Review',
      'its priority is urgent',
      'it has the label bug',
      'it is in Platform',
      'it is assigned to Sam Rivera',
    ])
  })

  it('says nothing for a rule that fires on everything', () => {
    expect(describeConditions({ if_unassigned: false }, vocabulary)).toEqual([])
  })

  it('distinguishes unassigned from any assignee', () => {
    expect(describeConditions({ if_unassigned: true }, vocabulary)).toEqual([
      'nobody is assigned',
    ])
  })
})

describe('describeActions', () => {
  it('reads out each action in the order they are applied', () => {
    const clauses = describeActions(
      {
        set_status_id: 4,
        set_priority: 'high',
        set_assignee_id: 7,
        add_label_id: 3,
        move_to_active_cycle: false,
        set_cycle_id: 5,
        comment_body: 'Please size this.',
      },
      vocabulary,
    )
    expect(clauses).toEqual([
      'set its status to Todo',
      'set its priority to high',
      'assign it to Sam Rivera',
      'add the label bug',
      'move it to Sprint 3',
      'post a comment',
    ])
  })

  it('prefers the active cycle over a named one, the way the backend does', () => {
    expect(
      describeActions({ move_to_active_cycle: true, set_cycle_id: 5 }, vocabulary),
    ).toEqual(['move it to the active cycle'])
  })

  it('ignores a comment body that is only whitespace', () => {
    expect(
      describeActions({ move_to_active_cycle: false, comment_body: '   ' }, vocabulary),
    ).toEqual([])
  })

  it('names something deleted rather than rendering a bare id', () => {
    expect(
      describeActions({ move_to_active_cycle: false, set_status_id: 999 }, vocabulary),
    ).toEqual(['set its status to a deleted status'])
  })
})

describe('joinClauses', () => {
  it('reads as a list rather than as an array', () => {
    expect(joinClauses(['a'])).toBe('a')
    expect(joinClauses(['a', 'b'])).toBe('a and b')
    expect(joinClauses(['a', 'b', 'c'])).toBe('a, b and c')
  })
})

describe('describeRule', () => {
  it('is the sentence somebody meant by the rule', () => {
    expect(
      describeRule(
        rule({
          trigger: 'status_changed',
          conditions: { if_status_id: 9, if_unassigned: false },
          actions: { set_assignee_id: 7, move_to_active_cycle: false },
        }),
        vocabulary,
      ),
    ).toBe(
      'When an issue changes status, if it is in In Review, assign it to Sam Rivera.',
    )
  })

  it('drops the "if" for a rule that fires on everything', () => {
    expect(
      describeRule(
        rule({ actions: { set_priority: 'urgent', move_to_active_cycle: false } }),
        vocabulary,
      ),
    ).toBe('When an issue is created, set its priority to urgent.')
  })

  it('says a stripped rule is empty rather than trailing off', () => {
    // Deleting a cycle takes `set_cycle_id` out of the rules that filled it.
    expect(describeRule(rule(), vocabulary)).toContain('this rule is empty')
  })
})

import type { QueryClient } from '@tanstack/react-query'

import type { TestCaseState, TestStep } from '@/api/generated/models'
import { i18n } from '@/i18n'

/** How each state reads, and its colour. Labels are getters over the catalog. */
export const CASE_STATES: Array<{ id: TestCaseState; label: string; colour: string }> = [
  caseState('draft', 'var(--color-neutral-400)'),
  caseState('ready', 'var(--color-status-done)'),
  caseState('retired', 'var(--color-neutral-300)'),
]

function caseState(id: TestCaseState, colour: string) {
  return {
    id,
    colour,
    get label() {
      return i18n.t(`tests:cases.states.${id}`)
    },
  }
}

export function caseStateMeta(state: TestCaseState) {
  return CASE_STATES.find((candidate) => candidate.id === state) ?? CASE_STATES[0]
}

/**
 * Refetch everything about a team's test cases (#274): its folders and their
 * counts, its lists of cases, each case, and the cases a ticket lists.
 */
export function invalidateCases(queryClient: QueryClient, teamId: number) {
  queryClient.invalidateQueries({ queryKey: [`/teams/${teamId}/test-folders`] })
  queryClient.invalidateQueries({ queryKey: [`/teams/${teamId}/test-cases`] })
  queryClient.invalidateQueries({
    predicate: (query) => {
      const key = String(query.queryKey[0] ?? '')
      return key.startsWith('/test-cases/') || /^\/tickets\/\d+\/test-cases$/.test(key)
    },
  })
}

/** A step being written: what to do and what should happen, and a key. */
export type DraftStep = TestStep & { key: number }

let nextKey = 1

export function draftSteps(steps: readonly TestStep[]): DraftStep[] {
  const drafts = steps.map((step) => ({ ...step, expected: step.expected ?? '', key: nextKey++ }))
  return drafts.length > 0 ? drafts : [blankStep()]
}

export function blankStep(): DraftStep {
  return { action: '', expected: '', key: nextKey++ }
}

/** The steps to send: blank ones left out, as the API would drop them. */
export function stepsToSend(steps: readonly DraftStep[]): TestStep[] {
  return steps
    .map(({ action, expected }) => ({ action: action.trim(), expected: (expected ?? '').trim() }))
    .filter((step) => step.action || step.expected)
}

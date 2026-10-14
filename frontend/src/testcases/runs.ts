import type { QueryClient } from '@tanstack/react-query'

import type { TestResult, TestRunProgress } from '@/api/generated/models'
import { i18n } from '@/i18n'

/** A result, or none yet: "not run". */
export type ResultOrNot = TestResult | 'not_run'

/**
 * How each result reads (#275), in the order a run's tally lists them. The
 * colours run green to red with blocked between; every place one shows also
 * names it, so colour is never the only cue.
 */
export const RESULT_META: Record<ResultOrNot, { readonly label: string; colour: string }> = {
  passed: result('passed', 'var(--color-status-done)'),
  failed: result('failed', 'var(--color-priority-urgent)'),
  blocked: result('blocked', 'var(--color-priority-medium)'),
  skipped: result('skipped', 'var(--color-neutral-400)'),
  not_run: result('notRun', 'var(--color-neutral-300)'),
}

function result(key: 'passed' | 'failed' | 'blocked' | 'skipped' | 'notRun', colour: string) {
  return {
    colour,
    get label() {
      return i18n.t(`tests:runs.results.${key}`)
    },
  }
}

export const RESULT_ORDER: TestResult[] = ['passed', 'failed', 'blocked', 'skipped']

/** Refetch a team's runs and everything that shows a result. */
export function invalidateRuns(queryClient: QueryClient, teamId: number) {
  queryClient.invalidateQueries({ queryKey: [`/teams/${teamId}/test-runs`] })
  queryClient.invalidateQueries({ queryKey: [`/teams/${teamId}/test-cases`] })
  queryClient.invalidateQueries({
    predicate: (query) => {
      const key = String(query.queryKey[0] ?? '')
      return (
        key.startsWith('/test-runs/') ||
        key.startsWith('/test-cases/') ||
        /^\/tickets\/\d+\/test-cases$/.test(key)
      )
    },
  })
}

/** The share of a run in each state, for its bar: done ones, then the rest. */
export function tallyParts(progress: TestRunProgress): Array<{ key: ResultOrNot; count: number }> {
  return [
    { key: 'passed', count: progress.passed },
    { key: 'failed', count: progress.failed },
    { key: 'blocked', count: progress.blocked },
    { key: 'skipped', count: progress.skipped },
    { key: 'not_run', count: progress.not_run },
  ]
}

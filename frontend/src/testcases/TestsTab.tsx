import { parseServerDate } from '@/api/dates'
import { useCaseRunsTestCasesCaseIdRunsGet, useListRunsTeamsTeamIdTestRunsGet } from '@/api/generated/endpoints/test-runs/test-runs'
import type { TestCaseRead } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { useState } from 'react'
import { useCanWrite } from '@/team/useCanWrite'
import { useTeamContext } from '@/team/useTeamContext'
import { NewRunDialog } from '@/testcases/NewRunDialog'
import { ResultChip } from '@/testcases/ResultChip'
import { RunPage } from '@/testcases/RunPage'
import { TestsView } from '@/testcases/TestsView'
import { Icon } from '@/ui/Icon'

/**
 * The Tests tab: test cases (#274), and the runs through them (#275) under
 * the folders. A run opens in place of the cases; a case lists every run it
 * has been in.
 */
export function TestsTab() {
  const { t } = useTranslation('tests')
  const { team } = useTeamContext()
  const canWrite = useCanWrite()
  const runs = useListRunsTeamsTeamIdTestRunsGet(team.id)
  const [runId, setRunId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)

  const nav = (
    <div className="mt-4">
      <h2 className="eyebrow px-1 pb-1">{t('runs.nav.heading')}</h2>
      <ul className="space-y-0.5">
        {(runs.data ?? []).map((run) => (
          <li key={run.id}>
            <button
              type="button"
              onClick={() => setRunId(run.id)}
              data-active={run.id === runId}
              aria-current={run.id === runId || undefined}
              className="nav-item w-full justify-between gap-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Icon
                  name={run.state === 'closed' ? 'check' : 'checklist'}
                  size={13}
                  className="shrink-0 text-neutral-400"
                />
                <span className="truncate">{run.name}</span>
              </span>
              {run.state === 'closed' && (
                <span className="sr-only">{t('runs.nav.closed')}</span>
              )}
            </button>
          </li>
        ))}
        {(runs.data ?? []).length === 0 && (
          <li className="px-2.5 py-1 text-xs text-neutral-400">{t('runs.nav.none')}</li>
        )}
      </ul>
      {canWrite && (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="nav-item mt-1 w-full text-neutral-500"
        >
          <Icon name="plus" size={13} />
          {t('runs.nav.newRun')}
        </button>
      )}
      {creating && (
        <NewRunDialog onClose={() => setCreating(false)} onCreated={(made) => setRunId(made.run.id)} />
      )}
    </div>
  )

  return (
    <TestsView
      runs={nav}
      main={runId !== null ? <RunPage runId={runId} onDeleted={() => setRunId(null)} /> : undefined}
      onShelf={() => setRunId(null)}
      caseExtra={(testCase) => <CaseRuns testCase={testCase} />}
    />
  )
}

/** A case, run after run (#275): every run it has been in, newest first,
 *  with the version each executed. */
function CaseRuns({ testCase }: { testCase: TestCaseRead }) {
  const { t } = useTranslation('tests')
  const runs = useCaseRunsTestCasesCaseIdRunsGet(testCase.id)
  const rows = runs.data ?? []
  return (
    <section className="mt-4">
      <h3 className="eyebrow">{t('runs.history.heading')}</h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-neutral-400">{t('runs.history.none')}</p>
      ) : (
        <ul className="mt-1 divide-y divide-neutral-900/8">
          {rows.map((row) => (
            <li key={row.run_id} className="flex items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-neutral-900">{row.run_name}</span>
                <span className="block text-xs text-neutral-500">
                  {t('runs.history.line', {
                    date: formatDate(
                      parseServerDate(row.ran_at ?? row.created_at),
                      t('runs.history.datePattern'),
                    ),
                    who: row.ran_by?.full_name ?? t('runs.history.nobody'),
                    version: row.version,
                  })}
                </span>
              </span>
              <ResultChip result={row.result} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

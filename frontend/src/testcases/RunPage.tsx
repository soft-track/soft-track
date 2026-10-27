import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { createPortal } from 'react-dom'

import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import {
  useCloseRunTestRunsRunIdClosePost,
  useDeleteRunTestRunsRunIdDelete,
  useGetRunTestRunsRunIdGet,
  useRaiseBugTestRunCasesRunCaseIdBugPost,
} from '@/api/generated/endpoints/test-runs/test-runs'
import type { TestRunCaseRead, TestRunDetail, TicketCreate } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { formatDate, formatList } from '@/i18n/format'
import { useCanWrite } from '@/team/useCanWrite'
import { useTeamContext } from '@/team/useTeamContext'
import { ResultChip } from '@/testcases/ResultChip'
import { ResultEditor } from '@/testcases/ResultEditor'
import { RESULT_META, invalidateRuns, tallyParts } from '@/testcases/runs'
import { bugSectionsFrom } from '@/tickets/bugSections'
import { TicketActionsMenu } from '@/tickets/detail/TicketActionsMenu'
import { invalidateTicketWrites } from '@/tickets/invalidateTickets'
import { NewTicketModal } from '@/tickets/NewTicketModal'
import { useOpenTicket } from '@/tickets/surface'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'

/**
 * A run (#275): that the cases were run, by whom, against what, and what
 * happened. A tally of passed, failed, blocked and not run yet, with the
 * bugs raised; then each case with who ran it and its result, a failure
 * linking to its bug or offering to raise one.
 */
export function RunPage({ runId, onDeleted }: { runId: number; onDeleted: () => void }) {
  const { t } = useTranslation(['tests', 'common'])
  const detail = useGetRunTestRunsRunIdGet(runId)
  if (detail.isLoading || !detail.data) {
    return (
      <section className="glass min-h-0 rounded-panel lg:col-span-1 xl:col-span-2">
        {detail.isError ? (
          <p className="py-10 text-center text-sm text-danger-600">{t('runs.page.error')}</p>
        ) : (
          <Loading label={t('runs.page.loading')} />
        )}
      </section>
    )
  }
  return <Run detail={detail.data} onDeleted={onDeleted} />
}

function Run({ detail, onDeleted }: { detail: TestRunDetail; onDeleted: () => void }) {
  const { t } = useTranslation(['tests', 'common'])
  const { team, releases = [], sprints, projects } = useTeamContext()
  const canWrite = useCanWrite()
  const queryClient = useQueryClient()
  const close = useCloseRunTestRunsRunIdClosePost()
  const remove = useDeleteRunTestRunsRunIdDelete()
  const [editing, setEditing] = useState<TestRunCaseRead | null>(null)
  const [raising, setRaising] = useState<TestRunCaseRead | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { run, cases } = detail
  const open = run.state === 'open'
  const writable = canWrite && open

  const release = releases.find((candidate) => candidate.id === run.release_id)
  const sprint = sprints.find((candidate) => candidate.id === run.sprint_id)
  const epic = projects.find((candidate) => candidate.id === run.project_id)
  const about = [
    release && t('runs.page.forRelease', { name: release.name }),
    sprint && t('runs.page.forSprint', { name: sprint.display_name }),
    epic && t('runs.page.forEpic', { name: epic.name }),
    run.environment,
    run.owner && t('runs.page.ownedBy', { name: run.owner.full_name }),
    t('runs.page.cases', { count: run.progress.total }),
  ].filter(Boolean)

  const act = async (work: () => Promise<unknown>) => {
    setError(null)
    try {
      await work()
      invalidateRuns(queryClient, team.id)
    } catch (err: unknown) {
      setError(errorDetail(err, t('runs.page.error')))
    }
  }

  const tally = [
    { key: 'passed', count: run.progress.passed, label: t('runs.page.passed'), colour: RESULT_META.passed.colour },
    { key: 'failed', count: run.progress.failed, label: t('runs.page.failed'), colour: RESULT_META.failed.colour },
    { key: 'blocked', count: run.progress.blocked, label: t('runs.page.blocked'), colour: RESULT_META.blocked.colour },
    ...(run.progress.skipped > 0
      ? [{ key: 'skipped', count: run.progress.skipped, label: t('runs.page.skipped'), colour: RESULT_META.skipped.colour }]
      : []),
    { key: 'not_run', count: run.progress.not_run, label: t('runs.page.notRun'), colour: 'var(--color-neutral-500)' },
    { key: 'bugs', count: run.progress.bugs, label: t('runs.page.bugs', { count: run.progress.bugs }), colour: 'var(--color-brand-600)' },
  ]

  return (
    <section
      aria-labelledby={`run-${run.id}`}
      className="glass scroll-thin min-h-0 overflow-y-auto rounded-panel lg:col-span-1 xl:col-span-2"
    >
      <header className="hairline border-b px-5 pb-4 pt-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 id={`run-${run.id}`} className="text-lg font-semibold tracking-tight text-neutral-900">
            {run.name}
          </h2>
          <span
            className="chip"
            style={{ ['--chip' as string]: open ? 'var(--color-brand-600)' : 'var(--color-neutral-400)' }}
          >
            {t(`runs.states.${run.state}`)}
          </span>
          {canWrite && (
            <div className="ml-auto flex items-center gap-2">
              {open && (
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm(t('runs.page.confirmClose', { name: run.name }))) return
                    act(() => close.mutateAsync({ runId: run.id }))
                  }}
                  className="btn btn-secondary btn-sm"
                >
                  {t('runs.page.close')}
                </button>
              )}
              {open && (
                <TicketActionsMenu
                  label={t('runs.page.more', { name: run.name })}
                  menuLabel={t('runs.page.menu')}
                  actions={[
                    {
                      label: t('runs.page.delete'),
                      icon: 'trash',
                      destructive: true,
                      onSelect: () => {
                        if (!window.confirm(t('runs.page.confirmDelete', { name: run.name }))) return
                        act(async () => {
                          await remove.mutateAsync({ runId: run.id })
                          onDeleted()
                        })
                      },
                    },
                  ]}
                />
              )}
            </div>
          )}
        </div>
        <p className="mt-1 text-sm text-neutral-600">{about.join(' · ')}</p>
        {!open && run.closed_at && (
          <p className="mt-1 text-xs text-neutral-500">
            {t('runs.page.closedNote', {
              date: formatDate(parseServerDate(run.closed_at), t('runs.page.datePattern')),
            })}
          </p>
        )}

        <dl
          aria-label={t('runs.page.tally')}
          className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
        >
          {tally.map((box) => (
            <div key={box.key} className="well rounded-card px-3 py-2">
              <dd className="identifier text-lg font-semibold" style={{ color: box.colour }}>
                {box.count}
              </dd>
              <dt className="text-xs text-neutral-500">{box.label}</dt>
            </div>
          ))}
        </dl>
        <RunBar parts={tallyParts(run.progress)} total={run.progress.total} />

        {error && (
          <p role="alert" className="mt-3 text-xs text-danger-600">
            {error}
          </p>
        )}
      </header>

      <ul className="divide-y divide-neutral-900/8">
        {cases.map((runCase) => (
          <CaseRow
            key={runCase.id}
            runCase={runCase}
            writable={writable}
            onEdit={() => setEditing(runCase)}
            onRaise={() => setRaising(runCase)}
          />
        ))}
      </ul>

      {editing && (
        <ResultEditor runCase={editing} runName={run.name} onClose={() => setEditing(null)} />
      )}
      {raising && (
        <RaiseBug
          runCase={raising}
          detail={detail}
          onClose={() => setRaising(null)}
        />
      )}
    </section>
  )
}

/** The run's results as one bar: passed, failed, blocked, skipped, to go. */
export function RunBar({
  parts,
  total,
}: {
  parts: ReturnType<typeof tallyParts>
  total: number
}) {
  return (
    <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-neutral-900/8" aria-hidden="true">
      {total > 0 &&
        parts
          .filter((part) => part.key !== 'not_run' && part.count > 0)
          .map((part) => (
            <span
              key={part.key}
              className="h-full"
              style={{ width: `${(part.count / total) * 100}%`, background: RESULT_META[part.key].colour }}
            />
          ))}
    </div>
  )
}

function CaseRow({
  runCase,
  writable,
  onEdit,
  onRaise,
}: {
  runCase: TestRunCaseRead
  writable: boolean
  onEdit: () => void
  onRaise: () => void
}) {
  const { t } = useTranslation('tests')
  const { team } = useTeamContext()
  const openTicket = useOpenTicket()
  const step = runCase.failed_step
  const line =
    step && runCase.note
      ? t('runs.page.failedStep', { step, note: runCase.note })
      : step
        ? t('runs.page.failedStepOnly', { step })
        : runCase.note

  return (
    <li
      className={`flex items-center gap-3 px-5 py-3 text-sm ${
        runCase.result === 'failed' ? 'bg-danger-500/[0.04]' : ''
      }`}
    >
      <span className="identifier w-12 shrink-0 text-xs text-neutral-400">{runCase.identifier}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-neutral-900">{runCase.title}</span>
        {line && <span className="block truncate text-xs text-neutral-500">{line}</span>}
      </span>
      {runCase.bug ? (
        <button
          type="button"
          onClick={() =>
            openTicket(
              { team_key: team.key, number: Number(runCase.bug!.identifier.split('-').pop()) },
              'panel',
            )
          }
          className="identifier shrink-0 text-xs font-semibold text-brand-700 hover:underline"
          title={runCase.bug.title}
        >
          {runCase.bug.identifier}
        </button>
      ) : (
        runCase.result === 'failed' &&
        writable && (
          <button type="button" onClick={onRaise} className="btn btn-secondary btn-xs shrink-0">
            <Icon name="bug" size={12} />
            {t('runs.page.raiseBug')}
          </button>
        )
      )}
      {runCase.ran_by ?? runCase.assignee ? (
        <Avatar
          user={(runCase.ran_by ?? runCase.assignee)!}
          size={22}
          decorative={false}
        />
      ) : (
        <span
          className="h-[22px] w-[22px] shrink-0 rounded-full border border-dashed border-neutral-900/20"
          title={t('runs.page.unassigned')}
        />
      )}
      {writable ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={t('runs.page.setResult', {
            identifier: runCase.identifier,
            result: RESULT_META[runCase.result ?? 'not_run'].label,
          })}
          className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <ResultChip result={runCase.result} />
        </button>
      ) : (
        <ResultChip result={runCase.result} />
      )}
    </li>
  )
}

/**
 * A bug from a failure (#275): the new-ticket form, arriving filled in --
 * the case's steps as steps to reproduce, the step that failed and the note
 * as what happened, the environment, and the release as found in -- and
 * made through the run, which links it to the result, the case and the
 * stories the case covers.
 */
function RaiseBug({
  runCase,
  detail,
  onClose,
}: {
  runCase: TestRunCaseRead
  detail: TestRunDetail
  onClose: () => void
}) {
  const { t } = useTranslation('tests')
  const { team } = useTeamContext()
  const queryClient = useQueryClient()
  const raise = useRaiseBugTestRunCasesRunCaseIdBugPost()
  const { run } = detail
  // Portalled: the run is a glass panel, which would otherwise be the
  // containing block of the form's fixed overlay and clip it.
  return createPortal(
    <NewTicketModal
      onClose={onClose}
      prefill={{
        title: runCase.title,
        type: 'bug',
        description: bugSectionsFrom(runCase.steps, runCase.failed_step, runCase.note),
        environment: run.environment,
        foundInId: run.release_id,
      }}
      context={t('runs.bug.linked', {
        cases: formatList([runCase.identifier, ...runCase.covers]),
      })}
      create={async (data: TicketCreate) => {
        await raise.mutateAsync({ runCaseId: runCase.id, data })
        invalidateRuns(queryClient, team.id)
        invalidateTicketWrites(queryClient, team.id)
      }}
    />,
    document.body,
  )
}

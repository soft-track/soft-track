import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { AXIOS_INSTANCE } from '../api/client'
import type { ImportReport } from '../api/generated/models'
import { useTeamContext } from '../team/TeamContext'

/**
 * Import a Jira export.
 *
 * Two steps on purpose: pick a file, read what it would do, then confirm. The
 * dry run and the real run take the same path on the server, so the report
 * shown here is the one that then happens rather than an estimate.
 */
export function ImportJiraModal({ onClose }: { onClose: () => void }) {
  const { team } = useTeamContext()
  const queryClient = useQueryClient()

  const [file, setFile] = useState<File | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const send = async (dryRun: boolean) => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const body = new FormData()
      body.append('file', file)
      body.append('dry_run', String(dryRun))
      const { data } = await AXIOS_INSTANCE.post<ImportReport>(
        `/teams/${team.id}/import/jira`,
        body,
      )
      setReport(data)
      if (!dryRun) {
        setDone(true)
        queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/issues`] })
        queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/labels`] })
        queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/projects`] })
      }
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data
        ?.detail
      setError(typeof detail === 'string' ? detail : 'That import could not be read.')
      setReport(null)
    } finally {
      setBusy(false)
    }
  }

  const unmatched = (report?.users ?? []).filter((user) => !user.matched_user_id)

  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center bg-black/20 p-4 pt-[8vh]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl"
      >
        <div className="border-b border-neutral-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-900">Import from Jira</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            A Jira CSV or JSON export. Export with the <em>Issue key</em> column so the
            import can be re-run safely.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              setReport(null)
              setDone(false)
              setError(null)
            }}
            className="w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-neutral-700 hover:file:bg-neutral-200"
          />

          {error && <p className="mt-3 text-sm text-danger-600">{error}</p>}

          {report && (
            <div className="mt-4 space-y-3">
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-sm font-medium text-neutral-800">
                  {done ? 'Imported' : 'This import would create'}
                </p>
                <ul className="mt-1 space-y-0.5 text-sm text-neutral-600">
                  <li>
                    <Count n={report.issues_created} one="issue" many="issues" />
                    {report.issues_skipped_existing > 0 && (
                      <span className="text-neutral-400">
                        {' '}
                        · {report.issues_skipped_existing} already imported, left alone
                      </span>
                    )}
                  </li>
                  <li>
                    <Count n={report.comments_created} one="comment" many="comments" />
                  </li>
                  {report.labels_created.length > 0 && (
                    <li>
                      <Count
                        n={report.labels_created.length}
                        one="new label"
                        many="new labels"
                      />
                      <span className="text-neutral-400">
                        {' '}
                        — {report.labels_created.join(', ')}
                      </span>
                    </li>
                  )}
                  {report.projects_created.length > 0 && (
                    <li>
                      <Count
                        n={report.projects_created.length}
                        one="project from an epic"
                        many="projects from epics"
                      />
                      <span className="text-neutral-400">
                        {' '}
                        — {report.projects_created.join(', ')}
                      </span>
                    </li>
                  )}
                </ul>
              </div>

              {report.warnings.length > 0 && (
                <ul className="space-y-1.5">
                  {report.warnings.map((warning) => (
                    <li
                      key={warning}
                      className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900"
                    >
                      {warning}
                    </li>
                  ))}
                </ul>
              )}

              {unmatched.length > 0 && !done && (
                <div>
                  <p className="mb-1 text-xs font-medium text-neutral-500">
                    Not members of this team
                  </p>
                  <ul className="space-y-0.5">
                    {unmatched.map((user) => (
                      <li key={user.source} className="text-xs text-neutral-600">
                        {user.source}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-neutral-400">
                    {/* The fix is outside this dialog, so say what it is. */}
                    Add them to the team first and re-run to attribute their work.
                  </p>
                </div>
              )}

              {report.preview.length > 0 && !done && (
                <div>
                  <p className="mb-1 text-xs font-medium text-neutral-500">
                    First {report.preview.length} of {report.issues_found}
                  </p>
                  <ul className="space-y-0.5">
                    {report.preview.map((issue, i) => (
                      <li
                        key={`${issue.external_key ?? i}`}
                        className="flex items-baseline gap-2 text-xs"
                      >
                        <span className="identifier shrink-0 text-neutral-400">
                          {issue.external_key ?? '—'}
                        </span>
                        <span className="truncate text-neutral-700">{issue.title}</span>
                        <span className="ml-auto shrink-0 text-neutral-400">
                          {issue.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-md px-2.5 py-1.5 text-sm text-neutral-500 hover:text-neutral-700"
          >
            {done ? 'Close' : 'Cancel'}
          </button>
          {!done && (
            <button
              onClick={() => send(report ? false : true)}
              disabled={!file || busy}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {busy
                ? 'Working…'
                : report
                  ? `Import ${report.issues_created} issues`
                  : 'Check the file'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Count({ n, one, many }: { n: number; one: string; many: string }) {
  return (
    <>
      <span className="identifier font-medium text-neutral-800">{n}</span>{' '}
      {n === 1 ? one : many}
    </>
  )
}

import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { AXIOS_INSTANCE } from '@/api/client'
import { errorDetail } from '@/api/errors'
import type { ImportReport } from '@/api/generated/models'
import { useTeamContext } from '@/team/TeamContext'
import { Icon } from '@/ui/Icon'

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
      setError(errorDetail(err, 'That import could not be read.'))
      setReport(null)
    } finally {
      setBusy(false)
    }
  }

  const unmatched = (report?.users ?? []).filter((user) => !user.matched_user_id)

  return (
    <div
      className="scrim fixed inset-0 z-30 flex items-start justify-center p-4 pt-[8vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Import from Jira"
        onClick={(e) => e.stopPropagation()}
        className="pop-in glass-strong flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-panel"
      >
        <div className="hairline border-b px-5 py-4">
          <h2 className="text-base font-semibold tracking-tight text-neutral-900">Import from Jira</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            A Jira CSV or JSON export. Export with the <em>Issue key</em> column so the
            import can be re-run safely.
          </p>
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <label className="well flex cursor-pointer items-center gap-3 rounded-card border-dashed px-4 py-3 transition hover:border-brand-400/60">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500/12 text-brand-700">
              <Icon name="upload" size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-neutral-800">
                {file ? file.name : 'Choose a Jira export'}
              </span>
              <span className="block text-xs text-neutral-400">
                {file ? `${Math.max(1, Math.round(file.size / 1024))} KB` : '.csv or .json, up to 20 MB'}
              </span>
            </span>
            <span className="btn btn-secondary btn-sm">Browse</span>
            <input
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="sr-only"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setReport(null)
                setDone(false)
                setError(null)
              }}
            />
          </label>

          {error && <p className="mt-3 text-sm text-danger-600">{error}</p>}

          {report && (
            <div className="mt-4 space-y-3">
              <div className="well rounded-card p-3">
                <p className="text-sm font-medium text-neutral-900">
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
                      className="chip h-auto whitespace-normal rounded-card px-3 py-2 text-xs font-normal"
                      style={{ ['--chip' as string]: 'var(--color-accent-amber)' }}
                    >
                      {warning}
                    </li>
                  ))}
                </ul>
              )}

              {unmatched.length > 0 && !done && (
                <div>
                  <p className="eyebrow mb-1">Not members of this team</p>
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
                  <p className="eyebrow mb-1">
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

        <div className="hairline flex items-center justify-end gap-2 border-t px-5 py-3">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            {done ? 'Close' : 'Cancel'}
          </button>
          {!done && (
            <button
              type="button"
              onClick={() => send(report ? false : true)}
              disabled={!file || busy}
              className="btn btn-primary"
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
      <span className="identifier font-medium text-neutral-900">{n}</span>{' '}
      {n === 1 ? one : many}
    </>
  )
}

import { useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { createPortal } from 'react-dom'

import { AXIOS_INSTANCE } from '@/api/client'
import { errorDetail } from '@/api/errors'
import type { TestCaseImport } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { useTeamContext } from '@/team/useTeamContext'
import { invalidateCases } from '@/testcases/cases'
import { useFocusTrap } from '@/ui/useFocusTrap'

/**
 * Test cases from a CSV in the export's shape (#274). Two steps, as the Jira
 * import has: check the file and read what it would do, then import.
 */
export function ImportCasesDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['tests', 'common'])
  const dialogRef = useFocusTrap<HTMLDivElement>()
  const titleId = useId()
  const { team } = useTeamContext()
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [report, setReport] = useState<TestCaseImport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async (dryRun: boolean) => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const body = new FormData()
      body.append('file', file)
      body.append('dry_run', String(dryRun))
      // Multipart, which the generated client does not build for us.
      const { data } = await AXIOS_INSTANCE.post<TestCaseImport>(
        `/teams/${team.id}/test-cases/import`,
        body,
      )
      setReport(data)
      if (!dryRun) invalidateCases(queryClient, team.id)
    } catch (err: unknown) {
      setError(errorDetail(err, t('cases.importer.error')))
      setReport(null)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="scrim fixed inset-0 z-40 flex items-start justify-center px-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
        className="pop-in glass-strong w-full max-w-md rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          {t('cases.importer.title')}
        </h2>
        <p className="mt-1 text-sm text-neutral-500">{t('cases.importer.intro')}</p>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">
            {t('cases.importer.file')}
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              setReport(null)
            }}
            className="block w-full text-sm"
          />
        </label>

        {report && (
          <ul className="well mt-4 space-y-1 rounded-control px-3 py-2.5 text-sm text-neutral-700">
            <li>{t('cases.importer.found', { count: report.cases_found })}</li>
            <li>
              {report.dry_run
                ? t('cases.importer.created', { count: report.cases_created })
                : t('cases.importer.made', { count: report.cases_created })}
            </li>
            {report.cases_skipped_existing > 0 && (
              <li>{t('cases.importer.skipped', { count: report.cases_skipped_existing })}</li>
            )}
            {report.folders_created.length > 0 && (
              <li>{t('cases.importer.folders', { names: report.folders_created.join(', ') })}</li>
            )}
            {report.warnings.map((warning) => (
              <li key={warning} className="text-xs text-neutral-500">
                {warning}
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p role="alert" className="mt-3 text-xs text-danger-600">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            {report && !report.dry_run ? t('common:close') : t('common:cancel')}
          </button>
          {!(report && !report.dry_run) &&
            (report?.dry_run ? (
              <button
                type="button"
                disabled={busy || report.cases_created === 0}
                onClick={() => send(false)}
                className="btn btn-primary btn-sm"
              >
                {busy ? t('cases.importer.importing') : t('cases.importer.run')}
              </button>
            ) : (
              <button
                type="button"
                disabled={!file || busy}
                onClick={() => send(true)}
                className="btn btn-primary btn-sm"
              >
                {t('cases.importer.preview')}
              </button>
            ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}

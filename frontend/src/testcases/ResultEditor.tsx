import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { AXIOS_INSTANCE } from '@/api/client'
import { errorDetail } from '@/api/errors'
import {
  useDeleteFileTestResultFilesResultFileIdDelete,
  useUpdateRunCaseTestRunCasesRunCaseIdPatch,
} from '@/api/generated/endpoints/test-runs/test-runs'
import type {
  TestResult,
  TestResultFileRead,
  TestRunCaseRead,
} from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { useTeamContext } from '@/team/useTeamContext'
import { RESULT_META, RESULT_ORDER, invalidateRuns } from '@/testcases/runs'
import { AssigneeOptions } from '@/tickets/AssigneeOptions'
import { Icon } from '@/ui/Icon'
import { Select } from '@/ui/Select'
import { useFocusTrap } from '@/ui/useFocusTrap'

/**
 * What happened when a case was run (#275): passed, failed, blocked or
 * skipped -- or not run yet -- with a note, the step that failed, files,
 * and who runs it. The case's steps are beside it, as they were at the
 * version run.
 */
export function ResultEditor({
  runCase,
  runName,
  onClose,
}: {
  runCase: TestRunCaseRead
  runName: string
  onClose: () => void
}) {
  const { t } = useTranslation(['tests', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const { team, members } = useTeamContext()
  const queryClient = useQueryClient()
  const update = useUpdateRunCaseTestRunCasesRunCaseIdPatch()
  const removeFile = useDeleteFileTestResultFilesResultFileIdDelete()
  const fileInput = useRef<HTMLInputElement>(null)

  const [result, setResult] = useState<TestResult | null>(runCase.result ?? null)
  const [failedStep, setFailedStep] = useState<string>(String(runCase.failed_step ?? ''))
  const [note, setNote] = useState(runCase.note ?? '')
  const [assignee, setAssignee] = useState<string>(String(runCase.assignee?.id ?? ''))
  const [files, setFiles] = useState<TestResultFileRead[]>(runCase.files)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      await update.mutateAsync({
        runCaseId: runCase.id,
        data: {
          result,
          failed_step: result === 'failed' && failedStep ? Number(failedStep) : null,
          note: note.trim() || null,
          assignee_id: assignee ? Number(assignee) : null,
        },
      })
      invalidateRuns(queryClient, team.id)
      onClose()
    } catch (err: unknown) {
      setError(errorDetail(err, t('runs.result.error')))
    }
  }

  const attach = async (file: File) => {
    setError(null)
    try {
      const body = new FormData()
      body.append('file', file)
      // Multipart, which the generated client does not build.
      const { data } = await AXIOS_INSTANCE.post<TestResultFileRead>(
        `/test-run-cases/${runCase.id}/files`,
        body,
      )
      setFiles((current) => [...current, data])
      invalidateRuns(queryClient, team.id)
    } catch (err: unknown) {
      setError(errorDetail(err, t('runs.result.error')))
    }
  }

  const open = async (file: TestResultFileRead) => {
    const { data } = await AXIOS_INSTANCE.get<Blob>(`/test-result-files/${file.id}/content`, {
      responseType: 'blob',
    })
    const url = URL.createObjectURL(data)
    window.open(url, '_blank', 'noopener,noreferrer')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return createPortal(
    <div
      className="scrim fixed inset-0 z-40 flex items-start justify-center overflow-y-auto px-4 py-[8vh]"
      onClick={onClose}
    >
      <form
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
        className="pop-in glass-strong w-full max-w-lg rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          {t('runs.result.title', { identifier: runCase.identifier, run: runName })}
        </h2>
        <p className="mt-0.5 text-sm text-neutral-600">{runCase.title}</p>

        {runCase.steps.length > 0 && (
          <ol className="well mt-3 space-y-1 rounded-control px-3 py-2 text-xs text-neutral-600">
            {runCase.steps.map((step, index) => (
              <li key={index} className="flex gap-2">
                <span className="identifier w-4 shrink-0 text-right text-neutral-400">{index + 1}</span>
                <span className="flex-1">{step.action}</span>
                <span className="flex-1 text-neutral-400">{step.expected}</span>
              </li>
            ))}
          </ol>
        )}

        <fieldset className="mt-4">
          <legend className="mb-1.5 text-xs font-medium text-neutral-500">
            {t('runs.result.label')}
          </legend>
          <div className="segmented" role="radiogroup">
            {[...RESULT_ORDER, null].map((choice) => (
              <button
                key={choice ?? 'not_run'}
                type="button"
                role="radio"
                aria-checked={result === choice}
                data-active={result === choice}
                onClick={() => setResult(choice)}
                className="segmented-item"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: RESULT_META[choice ?? 'not_run'].colour }}
                  aria-hidden="true"
                />
                {RESULT_META[choice ?? 'not_run'].label}
              </button>
            ))}
          </div>
        </fieldset>

        {result === 'failed' && runCase.steps.length > 0 && (
          <label className="mt-3 block">
            <span className="mb-1.5 block text-xs font-medium text-neutral-500">
              {t('runs.result.failedStep')}
            </span>
            <Select block dense value={failedStep} onChange={(e) => setFailedStep(e.target.value)}>
              <option value="">{t('runs.result.noStep')}</option>
              {runCase.steps.map((step, index) => (
                <option key={index} value={index + 1}>
                  {t('runs.result.stepOption', { n: index + 1, action: step.action })}
                </option>
              ))}
            </Select>
          </label>
        )}

        <label className="mt-3 block">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">
            {t('runs.result.note')}
          </span>
          <textarea
            rows={2}
            maxLength={5000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('runs.result.notePlaceholder')}
            className="field resize-y"
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">
            {t('runs.result.assignee')}
          </span>
          <Select block dense value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">{t('runs.result.nobody')}</option>
            <AssigneeOptions members={members} keepId={runCase.assignee?.id} />
          </Select>
        </label>

        <div className="mt-3">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">
            {t('runs.result.files')}
          </span>
          <ul className="space-y-1">
            {files.map((file) => (
              <li key={file.id} className="flex items-center gap-2 text-sm">
                <Icon name="paperclip" size={13} className="text-neutral-400" />
                <button
                  type="button"
                  onClick={() => open(file)}
                  className="min-w-0 flex-1 truncate text-left text-brand-700 hover:underline"
                >
                  {file.filename}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await removeFile.mutateAsync({ resultFileId: file.id })
                    setFiles((current) => current.filter((other) => other.id !== file.id))
                    invalidateRuns(queryClient, team.id)
                  }}
                  aria-label={t('runs.result.removeFile', { name: file.filename })}
                  className="btn btn-ghost btn-icon btn-xs text-neutral-400"
                >
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ul>
          <input
            ref={fileInput}
            type="file"
            className="sr-only"
            aria-label={t('runs.result.attach')}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) attach(file)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="btn btn-ghost btn-xs mt-1"
          >
            <Icon name="paperclip" size={12} />
            {t('runs.result.attach')}
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-xs text-danger-600">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            {t('common:cancel')}
          </button>
          <button type="submit" disabled={update.isPending} className="btn btn-primary btn-sm">
            {update.isPending ? t('common:saving') : t('runs.result.save')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

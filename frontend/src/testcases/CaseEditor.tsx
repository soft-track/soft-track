import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { createPortal } from 'react-dom'

import { errorDetail } from '@/api/errors'
import {
  useCreateCaseTeamsTeamIdTestCasesPost,
  useUpdateCaseTestCasesCaseIdPatch,
} from '@/api/generated/endpoints/test-cases/test-cases'
import type {
  TestCaseRead,
  TestCaseState,
  TestFolderRead,
} from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { MarkdownEditor } from '@/markdown/lazy'
import { activeMembers } from '@/team/members'
import { useTeamContext } from '@/team/useTeamContext'
import {
  CASE_STATES,
  blankStep,
  draftSteps,
  invalidateCases,
  stepsToSend,
} from '@/testcases/cases'
import { AssigneeOptions } from '@/tickets/AssigneeOptions'
import { Icon } from '@/ui/Icon'
import { Select } from '@/ui/Select'
import { useFocusTrap } from '@/ui/useFocusTrap'

/**
 * Writing a test case down (#274), or changing one: a title, preconditions,
 * and numbered steps, each with what should happen; and its folder, owner,
 * state and labels. A change to the title, preconditions or steps is a new
 * version, which can say what changed.
 */
export function CaseEditor({
  testCase,
  folders,
  folderId = null,
  coverIds = [],
  onClose,
  onSaved,
}: {
  /** The case being edited; absent for a new one. */
  testCase?: TestCaseRead
  folders: TestFolderRead[]
  /** The folder a new case starts in: the one open beside it. */
  folderId?: number | null
  /** What a new case covers from the start: the story it is written for. */
  coverIds?: number[]
  onClose: () => void
  onSaved?: (testCase: TestCaseRead) => void
}) {
  const { t } = useTranslation(['tests', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const { team, members, labels } = useTeamContext()
  const queryClient = useQueryClient()
  const create = useCreateCaseTeamsTeamIdTestCasesPost()
  const update = useUpdateCaseTestCasesCaseIdPatch()

  const [title, setTitle] = useState(testCase?.title ?? '')
  const [preconditions, setPreconditions] = useState(testCase?.preconditions ?? '')
  const [steps, setSteps] = useState(() => draftSteps(testCase?.steps ?? []))
  const [folder, setFolder] = useState<string>(
    String(testCase ? (testCase.folder_id ?? '') : (folderId ?? '')),
  )
  const [owner, setOwner] = useState<string>(String(testCase?.owner?.id ?? ''))
  const [state, setState] = useState<TestCaseState>(testCase?.state ?? 'draft')
  const [labelIds, setLabelIds] = useState<number[]>(
    testCase?.labels.map((label) => label.id) ?? [],
  )
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const pending = create.isPending || update.isPending

  const setStep = (key: number, field: 'action' | 'expected', value: string) =>
    setSteps((current) =>
      current.map((step) => (step.key === key ? { ...step, [field]: value } : step)),
    )

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const data = {
      title: title.trim(),
      preconditions: preconditions.trim() || null,
      steps: stepsToSend(steps),
      folder_id: folder ? Number(folder) : null,
      owner_id: owner ? Number(owner) : null,
      state,
      label_ids: labelIds,
    }
    try {
      const saved = testCase
        ? await update.mutateAsync({
            caseId: testCase.id,
            data: { ...data, change_note: note.trim() || null },
          })
        : await create.mutateAsync({ teamId: team.id, data: { ...data, ticket_ids: coverIds } })
      invalidateCases(queryClient, team.id)
      onSaved?.(saved)
      onClose()
    } catch (err: unknown) {
      setError(errorDetail(err, t('cases.editor.error')))
    }
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
        className="pop-in glass-strong w-full max-w-2xl rounded-panel p-5"
      >
        <h2 id={titleId} className="mb-4 text-base font-semibold tracking-tight text-neutral-900">
          {testCase
            ? t('cases.editor.editTitle', { identifier: testCase.identifier })
            : t('cases.editor.newTitle')}
        </h2>

        <label className="mb-3 block">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">
            {t('cases.editor.title')}
          </span>
          <input
            autoFocus
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('cases.editor.titlePlaceholder')}
            className="field"
          />
        </label>

        <div className="mb-3">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">
            {t('cases.editor.preconditions')}
          </span>
          <MarkdownEditor
            value={preconditions}
            onChange={setPreconditions}
            people={activeMembers(members)}
            placeholder={t('cases.editor.preconditionsPlaceholder')}
            rows={2}
            compact
          />
        </div>

        <fieldset className="mb-3">
          <legend className="mb-1.5 text-xs font-medium text-neutral-500">
            {t('cases.editor.steps')}
          </legend>
          <ol className="space-y-2">
            {steps.map((step, index) => (
              <li key={step.key} className="flex items-start gap-2">
                <span className="identifier w-5 shrink-0 pt-2 text-right text-xs text-neutral-400">
                  {index + 1}
                </span>
                <input
                  value={step.action}
                  onChange={(e) => setStep(step.key, 'action', e.target.value)}
                  aria-label={t('cases.editor.stepAction', { n: index + 1 })}
                  placeholder={index === 0 ? t('cases.editor.actionPlaceholder') : undefined}
                  maxLength={1000}
                  className="field field-sm min-w-0 flex-1"
                />
                <input
                  value={step.expected}
                  onChange={(e) => setStep(step.key, 'expected', e.target.value)}
                  aria-label={t('cases.editor.stepExpected', { n: index + 1 })}
                  placeholder={index === 0 ? t('cases.editor.expectedPlaceholder') : undefined}
                  maxLength={1000}
                  className="field field-sm min-w-0 flex-1"
                />
                <button
                  type="button"
                  onClick={() =>
                    setSteps((current) =>
                      current.length > 1
                        ? current.filter((other) => other.key !== step.key)
                        : [blankStep()],
                    )
                  }
                  aria-label={t('cases.editor.removeStep', { n: index + 1 })}
                  className="btn btn-ghost btn-icon btn-xs mt-1 text-neutral-400"
                >
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() => setSteps((current) => [...current, blankStep()])}
            className="btn btn-ghost btn-xs mt-2"
          >
            <Icon name="plus" size={12} />
            {t('cases.editor.addStep')}
          </button>
        </fieldset>

        <div className="mb-3 flex flex-wrap gap-2">
          <Select
            dense
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            aria-label={t('cases.editor.folder')}
          >
            <option value="">{t('cases.editor.noFolder')}</option>
            {folders.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </Select>
          <Select
            dense
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            aria-label={t('cases.editor.owner')}
          >
            <option value="">{t('cases.editor.noOwner')}</option>
            <AssigneeOptions members={members} keepId={testCase?.owner?.id} />
          </Select>
          <Select
            dense
            value={state}
            onChange={(e) => setState(e.target.value as TestCaseState)}
            aria-label={t('cases.editor.state')}
          >
            {CASE_STATES.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </Select>
        </div>

        {labels.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5" aria-label={t('cases.editor.labels')}>
            {labels.map((label) => {
              const active = labelIds.includes(label.id)
              return (
                <button
                  key={label.id}
                  type="button"
                  data-active={active}
                  aria-pressed={active}
                  onClick={() =>
                    setLabelIds((current) =>
                      active ? current.filter((id) => id !== label.id) : [...current, label.id],
                    )
                  }
                  className="chip chip-toggle"
                  style={{ ['--chip' as string]: label.color }}
                >
                  {label.name}
                </button>
              )
            })}
          </div>
        )}

        {testCase && (
          <label className="mb-3 block">
            <span className="mb-1.5 block text-xs font-medium text-neutral-500">
              {t('cases.editor.changeNote')}
            </span>
            <input
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('cases.editor.changeNotePlaceholder')}
              className="field field-sm"
            />
            <span className="mt-1 block text-[11px] text-neutral-400">
              {t('cases.editor.changeNoteHint')}
            </span>
          </label>
        )}

        {error && (
          <p role="alert" className="mb-3 text-xs text-danger-600">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            {t('common:cancel')}
          </button>
          <button type="submit" disabled={pending || !title.trim()} className="btn btn-primary">
            {testCase
              ? pending
                ? t('common:saving')
                : t('cases.editor.save')
              : pending
                ? t('cases.editor.creating')
                : t('cases.editor.create')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

import { type FormEvent, useId, useState } from 'react'
import { createPortal } from 'react-dom'

import { errorDetail } from '@/api/errors'
import { useCompleteSprintSprintsSprintIdCompletePost } from '@/api/generated/endpoints/sprints/sprints'
import type { SprintCompletion, SprintOutcome, SprintRead } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { useFocusTrap } from '@/ui/useFocusTrap'

const OUTCOMES: SprintOutcome[] = ['met', 'partly', 'missed']

/**
 * Completing a sprint asks two more things (#271): whether its goal was met,
 * and the retrospective -- what went well, what did not, what to change.
 * Both can be left for later; completing is what this does either way.
 */
export function CompleteSprintDialog({
  sprint,
  onClose,
  onCompleted,
}: {
  sprint: SprintRead
  onClose: () => void
  onCompleted: (result: SprintCompletion) => void
}) {
  const { t } = useTranslation(['sprints', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const complete = useCompleteSprintSprintsSprintIdCompletePost()

  const [outcome, setOutcome] = useState<SprintOutcome | null>(null)
  const [wentWell, setWentWell] = useState('')
  const [didNot, setDidNot] = useState('')
  const [toChange, setToChange] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { progress } = sprint
  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      const result = await complete.mutateAsync({
        sprintId: sprint.id,
        data: {
          outcome,
          went_well: wentWell || null,
          did_not: didNot || null,
          to_change: toChange || null,
        },
      })
      onCompleted(result)
    } catch (err: unknown) {
      setError(errorDetail(err, t('banner.error')))
    }
  }

  const sections = [
    ['wentWell', wentWell, setWentWell],
    ['didNot', didNot, setDidNot],
    ['toChange', toChange, setToChange],
  ] as const

  return createPortal(
    <div
      className="scrim fixed inset-0 z-40 flex items-start justify-center overflow-y-auto px-4 py-[10vh]"
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
        className="pop-in glass-strong w-full max-w-lg rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          {t('retro.complete.title', { name: sprint.display_name })}
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          {progress.points_total > 0
            ? t('retro.complete.points', {
                done: progress.points_completed,
                total: progress.points_total,
              })
            : t('retro.complete.tickets', {
                done: progress.tickets_completed,
                total: progress.tickets_total,
              })}
        </p>

        {sprint.goal && (
          <blockquote className="well mt-3 rounded-control px-3 py-2 text-sm text-neutral-700">
            {sprint.goal}
          </blockquote>
        )}

        <fieldset className="mt-4">
          <legend className="mb-1.5 text-xs font-medium text-neutral-500">
            {t('retro.complete.question')}
          </legend>
          <div className="segmented" role="radiogroup">
            {OUTCOMES.map((choice) => (
              <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={outcome === choice}
                data-active={outcome === choice}
                onClick={() => setOutcome(outcome === choice ? null : choice)}
                className="segmented-item"
              >
                {t(`retro.choice.${choice}`)}
              </button>
            ))}
          </div>
        </fieldset>

        <p className="mb-1.5 mt-4 text-xs font-medium text-neutral-500">
          {t('retro.complete.retrospective')}{' '}
          <span className="font-normal text-neutral-400">· {t('retro.complete.later')}</span>
        </p>
        <div className="space-y-2">
          {sections.map(([key, value, set]) => (
            <label key={key} className="block">
              <span className="mb-1 block text-xs text-neutral-500">{t(`retro.sections.${key}`)}</span>
              <textarea
                rows={2}
                value={value}
                onChange={(e) => set(e.target.value)}
                className="field resize-y"
              />
            </label>
          ))}
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
          <button type="submit" disabled={complete.isPending} className="btn btn-primary btn-sm">
            {complete.isPending ? t('retro.complete.completing') : t('retro.complete.submit')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { createPortal } from 'react-dom'

import { errorDetail } from '@/api/errors'
import { useReleaseReleaseReleasesReleaseIdReleasePost } from '@/api/generated/endpoints/releases/releases'
import type { ReleaseRead, ReleaseResult } from '@/api/generated/models'
import { Trans, useTranslation, userText } from '@/i18n'
import { invalidateReleases, nextRelease } from '@/releases/releases'
import { useTeamContext } from '@/team/useTeamContext'
import { localToday } from '@/tickets/dueDate'
import { invalidateTicketWrites } from '@/tickets/invalidateTickets'
import { Select } from '@/ui/Select'
import { showToast } from '@/ui/toast'
import { useFocusTrap } from '@/ui/useFocusTrap'

/**
 * Releasing asks about the rest (#272): the day it shipped, and what to do
 * with the tickets that are not done -- move them to the next release, or
 * leave them without one. Cancelled tickets are not asked about: they are
 * not waiting for anything.
 */
export function ReleaseDialog({
  release,
  onClose,
  onReleased,
}: {
  release: ReleaseRead
  onClose: () => void
  onReleased?: (result: ReleaseResult) => void
}) {
  const { t } = useTranslation(['releases', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const { team, releases = [] } = useTeamContext()
  const queryClient = useQueryClient()
  const releaseIt = useReleaseReleaseReleasesReleaseIdReleasePost()

  const unfinished = release.progress.tickets_total - release.progress.tickets_done
  const others = releases.filter(
    (candidate) => candidate.state === 'planned' && candidate.id !== release.id,
  )
  const suggested = nextRelease(releases, release)
  const [releasedOn, setReleasedOn] = useState(localToday())
  const [choice, setChoice] = useState<'move' | 'leave'>(suggested ? 'move' : 'leave')
  const [targetId, setTargetId] = useState<number | null>(suggested?.id ?? null)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const moveTo = unfinished > 0 && choice === 'move' ? targetId : null
    try {
      const result = await releaseIt.mutateAsync({
        releaseId: release.id,
        data: { released_on: releasedOn || null, move_to_release_id: moveTo },
      })
      invalidateReleases(queryClient, team.id)
      if (result.moved > 0) invalidateTicketWrites(queryClient, team.id)
      const next = others.find((candidate) => candidate.id === result.moved_to_release_id)
      showToast(
        result.moved === 0
          ? t('release.doneAll', { name: release.name })
          : next
            ? t('release.done', { name: release.name, count: result.moved, next: next.name })
            : t('release.doneLeft', { name: release.name, count: result.moved }),
      )
      onReleased?.(result)
      onClose()
    } catch (err: unknown) {
      setError(errorDetail(err, t('release.error')))
    }
  }

  // Portalled: the release's page is a glass panel, and its backdrop-filter
  // would make it the containing block of a fixed overlay inside it.
  return createPortal(
    <div
      className="scrim fixed inset-0 z-40 flex items-start justify-center px-4 pt-[15vh]"
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
        className="pop-in glass-strong w-full max-w-sm rounded-panel p-5"
      >
        <h2 id={titleId} className="mb-4 text-base font-semibold tracking-tight text-neutral-900">
          {t('release.title', { name: release.name })}
        </h2>

        <label className="mb-4 block">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">
            {t('release.releasedOn')}
          </span>
          <input
            type="date"
            required
            value={releasedOn}
            onChange={(e) => setReleasedOn(e.target.value)}
            className="field max-w-44"
          />
        </label>

        {unfinished === 0 ? (
          <p className="mb-4 text-sm text-neutral-700">
            {t('release.allDone', { name: release.name })}
          </p>
        ) : (
          <fieldset className="mb-4">
            <legend className="mb-2 text-sm text-neutral-800">
              <Trans
                t={t}
                i18nKey="release.unfinished"
                count={unfinished}
                values={{ count: unfinished, name: release.name }}
                components={{ strong: <strong className="font-semibold" /> }}
                {...userText}
              />
            </legend>
            <label className="flex items-center gap-2.5 py-1 text-sm text-neutral-800">
              <input
                type="radio"
                name="unfinished"
                checked={choice === 'move'}
                disabled={others.length === 0}
                onChange={() => setChoice('move')}
                className="accent-[var(--color-brand-600)]"
              />
              {t('release.move')}
            </label>
            {others.length === 0 ? (
              <p className="mb-1 ml-6 text-xs text-neutral-500">{t('release.noNext')}</p>
            ) : (
              <div className="mb-1 ml-6">
                <Select
                  block
                  dense
                  aria-label={t('release.moveTo')}
                  disabled={choice !== 'move'}
                  value={targetId ?? ''}
                  onChange={(e) => setTargetId(Number(e.target.value))}
                >
                  {others.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <label className="flex items-center gap-2.5 py-1 text-sm text-neutral-800">
              <input
                type="radio"
                name="unfinished"
                checked={choice === 'leave'}
                onChange={() => setChoice('leave')}
                className="accent-[var(--color-brand-600)]"
              />
              {t('release.leave')}
            </label>
          </fieldset>
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
          <button type="submit" disabled={releaseIt.isPending} className="btn btn-primary">
            {releaseIt.isPending ? t('release.releasing') : t('release.submit')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { createPortal } from 'react-dom'

import { errorDetail } from '@/api/errors'
import {
  useCreateReleaseTeamsTeamIdReleasesPost,
  useUpdateReleaseReleasesReleaseIdPatch,
} from '@/api/generated/endpoints/releases/releases'
import type { ReleaseRead } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { invalidateReleases } from '@/releases/releases'
import { useTeamContext } from '@/team/useTeamContext'
import { useFocusTrap } from '@/ui/useFocusTrap'

/**
 * Making a release (#272), or editing one: a name -- "1.4.0" -- a
 * description and a target date. Its state changes elsewhere: releasing asks
 * about the tickets that are not done, and archiving is a menu action.
 */
export function ReleaseFormDialog({
  release,
  onClose,
  onSaved,
}: {
  /** The release being edited; absent for a new one. */
  release?: ReleaseRead
  onClose: () => void
  onSaved?: (release: ReleaseRead) => void
}) {
  const { t } = useTranslation(['releases', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const { team } = useTeamContext()
  const queryClient = useQueryClient()
  const create = useCreateReleaseTeamsTeamIdReleasesPost()
  const update = useUpdateReleaseReleasesReleaseIdPatch()

  const [name, setName] = useState(release?.name ?? '')
  const [description, setDescription] = useState(release?.description ?? '')
  const [target, setTarget] = useState(release?.target_date ?? '')
  const [error, setError] = useState<string | null>(null)
  const pending = create.isPending || update.isPending

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const data = {
      name: name.trim(),
      description: description.trim() || null,
      target_date: target || null,
    }
    try {
      const saved = release
        ? await update.mutateAsync({ releaseId: release.id, data })
        : await create.mutateAsync({ teamId: team.id, data })
      invalidateReleases(queryClient, team.id)
      onSaved?.(saved)
      onClose()
    } catch (err: unknown) {
      setError(errorDetail(err, t('form.error')))
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
          {release ? t('form.editTitle', { name: release.name }) : t('form.newTitle')}
        </h2>

        <label className="mb-3 block">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">{t('form.name')}</span>
          <input
            autoFocus
            required
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('form.namePlaceholder')}
            className="field font-mono"
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">
            {t('form.description')}
          </span>
          <textarea
            rows={2}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('form.descriptionPlaceholder')}
            className="field resize-y"
          />
        </label>

        <label className="mb-4 block">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">
            {t('form.target')}
          </span>
          <input
            type="date"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="field"
          />
        </label>

        {error && (
          <p role="alert" className="mb-3 text-xs text-danger-600">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            {t('common:cancel')}
          </button>
          <button type="submit" disabled={pending || !name.trim()} className="btn btn-primary">
            {release
              ? pending
                ? t('common:saving')
                : t('form.save')
              : pending
                ? t('form.creating')
                : t('form.create')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

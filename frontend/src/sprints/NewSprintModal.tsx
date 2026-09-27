import { useQueryClient } from '@tanstack/react-query'
import { addDays, format } from 'date-fns'
import { type FormEvent, useId, useState } from 'react'

import { useCreateSprintTeamsTeamIdSprintsPost } from '@/api/generated/endpoints/sprints/sprints'
import { errorDetail } from '@/api/errors'
import { useTranslation } from '@/i18n'
import { useTeamContext } from '@/team/useTeamContext'
import { useFocusTrap } from '@/ui/useFocusTrap'

/** A day, as the value an <input type="date"> wants. */
const asDateInput = (date: Date) => format(date, 'yyyy-MM-dd')

export function NewSprintModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['sprints', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const { team } = useTeamContext()
  const queryClient = useQueryClient()
  const createSprint = useCreateSprintTeamsTeamIdSprintsPost()

  const [name, setName] = useState('')
  // A fortnight from today: the common case, and still editable.
  const [startsAt, setStartsAt] = useState(asDateInput(new Date()))
  const [endsAt, setEndsAt] = useState(asDateInput(addDays(new Date(), 14)))
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      await createSprint.mutateAsync({
        teamId: team.id,
        data: {
          name: name.trim() || undefined,
          starts_at: new Date(`${startsAt}T00:00:00Z`).toISOString(),
          ends_at: new Date(`${endsAt}T23:59:59Z`).toISOString(),
        },
      })
      queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/sprints`] })
      onClose()
    } catch (err: unknown) {
      setError(errorDetail(err, t('newSprint.error')))
    }
  }

  return (
    <div
      className="scrim fixed inset-0 z-30 flex items-start justify-center px-4 pt-[15vh]"
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
        className="pop-in glass-strong w-full max-w-sm rounded-panel p-5"
      >
        <h2 id={titleId} className="mb-4 text-base font-semibold tracking-tight text-neutral-900">
          {t('newSprint.title')}
        </h2>

        <label className="mb-3 block">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">
            {t('newSprint.name')}
          </span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('newSprint.namePlaceholder')}
            className="field"
          />
        </label>

        <div className="mb-4 flex gap-3">
          <label className="flex-1">
            <span className="mb-1.5 block text-xs font-medium text-neutral-500">
              {t('newSprint.starts')}
            </span>
            <input
              type="date"
              required
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="field"
            />
          </label>
          <label className="flex-1">
            <span className="mb-1.5 block text-xs font-medium text-neutral-500">
              {t('newSprint.ends')}
            </span>
            <input
              type="date"
              required
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="field"
            />
          </label>
        </div>

        {error && <p className="mb-3 text-xs text-danger-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            {t('common:cancel')}
          </button>
          <button type="submit" disabled={createSprint.isPending} className="btn btn-primary">
            {createSprint.isPending ? t('newSprint.creating') : t('newSprint.create')}
          </button>
        </div>
      </form>
    </div>
  )
}

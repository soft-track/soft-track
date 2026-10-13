import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type KeyboardEvent, useId, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  getTeamCreationAccessTeamsCreationGetQueryKey,
  useRequestTeamTeamsRequestsPost,
} from '@/api/generated/endpoints/teams/teams'
import type { TeamCreationAccess } from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { Trans, userText, useTranslation } from '@/i18n'
import { formatList } from '@/i18n/format'
import { Icon } from '@/ui/Icon'
import { useFocusTrap } from '@/ui/useFocusTrap'

/**
 * Where creating a team is left to some (#306): who creates them here, who
 * to ask, and a way to ask for one. In place of the form on /new-team and of
 * "Create a team" on the page for somebody with no team (#318).
 */
export function AskForTeamCard({ access }: { access: TeamCreationAccess }) {
  const { t } = useTranslation('team')
  const [asking, setAsking] = useState(false)
  const admins = access.site_admins.map((admin) => admin.full_name)

  return (
    <div className="glass-strong rounded-panel p-5">
      <h2 className="text-sm font-medium text-neutral-900">
        {access.policy === 'named_people'
          ? t('askForTeam.card.titleNamedPeople')
          : t('askForTeam.card.titleSiteAdmins')}
      </h2>
      <p className="mt-0.5 text-sm text-neutral-500">
        {admins.length > 0
          ? t('askForTeam.card.ask', { names: formatList(admins) })
          : t('askForTeam.card.askNobody')}
      </p>
      {access.pending_requests.map((request) => (
        <p
          key={request.id}
          className="mt-3 flex items-start gap-1.5 rounded-control bg-brand-500/8 px-3 py-2 text-xs text-neutral-600"
        >
          <Icon name="history" size={13} className="mt-0.5 shrink-0 text-brand-600" />
          <span>
            <Trans
              t={t}
              i18nKey="askForTeam.card.pending"
              values={{ name: request.name, key: request.key }}
              {...userText}
              components={{ strong: <strong className="font-medium text-neutral-900" /> }}
            />
          </span>
        </p>
      ))}
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="btn btn-secondary btn-sm mt-4"
      >
        <Icon name="plus" size={14} />
        {t('askForTeam.card.button')}
      </button>
      {asking && <AskForTeamDialog onClose={() => setAsking(false)} />}
    </div>
  )
}

function closeOnEscape(onClose: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
    }
  }
}

/** A name, a key and a reason; the site admins decide. */
export function AskForTeamDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['team', 'common'])
  const queryClient = useQueryClient()
  const requestTeam = useRequestTeamTeamsRequestsPost()
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const nameId = useId()
  const keyId = useId()
  const reasonId = useId()
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      await requestTeam.mutateAsync({ data: { name, key, reason } })
      void queryClient.invalidateQueries({
        queryKey: getTeamCreationAccessTeamsCreationGetQueryKey(),
      })
      onClose()
    } catch (err: unknown) {
      setError(errorDetail(err, t('askForTeam.dialog.error')))
    }
  }

  // Into the body: the card it opens from is glass, whose backdrop filter
  // would otherwise make it the box `fixed` is measured against.
  return createPortal(
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
        onKeyDown={closeOnEscape(onClose)}
        onClick={(e) => e.stopPropagation()}
        className="pop-in glass-strong w-full max-w-md rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          {t('askForTeam.dialog.title')}
        </h2>

        {error && (
          <div
            role="alert"
            className="mt-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </div>
        )}

        <div className="mt-4 grid grid-cols-[1fr_8rem] gap-3">
          <div>
            <label htmlFor={nameId} className="mb-1.5 block text-xs font-medium text-neutral-500">
              {t('askForTeam.dialog.name')}
            </label>
            <input
              id={nameId}
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('askForTeam.dialog.namePlaceholder')}
              className="field"
            />
          </div>
          <div>
            <label htmlFor={keyId} className="mb-1.5 block text-xs font-medium text-neutral-500">
              {t('askForTeam.dialog.key')}
            </label>
            <input
              id={keyId}
              required
              minLength={2}
              maxLength={6}
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
              placeholder={t('askForTeam.dialog.keyPlaceholder')}
              className="field identifier uppercase tracking-wide"
            />
          </div>
        </div>

        <label htmlFor={reasonId} className="mb-1.5 mt-3 block text-xs font-medium text-neutral-500">
          {t('askForTeam.dialog.reason')}
        </label>
        <textarea
          id={reasonId}
          required
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('askForTeam.dialog.reasonPlaceholder')}
          className="field resize-none"
        />

        <p className="mt-3 text-xs text-neutral-500">{t('askForTeam.dialog.note')}</p>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            {t('common:cancel')}
          </button>
          <button
            type="submit"
            disabled={requestTeam.isPending}
            className="btn btn-primary btn-sm"
          >
            {requestTeam.isPending ? t('askForTeam.dialog.asking') : t('askForTeam.dialog.ask')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

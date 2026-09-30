import { useId, useState } from 'react'

import { errorDetail } from '@/api/errors'
import { useListTicketsTeamsTeamIdTicketsGet } from '@/api/generated/endpoints/tickets/tickets'
import type { TeamMemberRead, UserPublic } from '@/api/generated/models'
import { Trans, userText, useTranslation } from '@/i18n'
import { AssigneeOptions } from '@/tickets/AssigneeOptions'
import { Select } from '@/ui/Select'
import { useFocusTrap } from '@/ui/useFocusTrap'

/** How many of the tickets are named; the rest are counted. */
const NAMED = 8

export type HandOver = 'remove' | 'leave' | 'guest'

/**
 * The question asked before somebody stops being able to hold the team's
 * tickets (#316): removed, leaving, or made a guest.
 *
 * It counts the open tickets they hold here and offers the two answers the
 * API takes: leave them unassigned, or give them to somebody on the team.
 * Done and cancelled tickets are not counted, since they keep their assignee
 * either way. With nothing open it is only the question.
 */
export function HandOverDialog({
  change,
  person,
  team,
  members,
  onClose,
  onConfirm,
}: {
  change: HandOver
  person: UserPublic
  team: { id: number; name: string }
  members: TeamMemberRead[]
  onClose: () => void
  /** Resolves once done. `reassignTo` is undefined for "unassigned". */
  onConfirm: (reassignTo: number | undefined) => Promise<void>
}) {
  const { t } = useTranslation(['settings', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const [giveTo, setGiveTo] = useState<'nobody' | 'somebody'>('nobody')
  const [personId, setPersonId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const held = useListTicketsTeamsTeamIdTicketsGet(team.id, {
    assignee_id: person.id,
    resolved: false,
    sort: 'created',
    direction: 'asc',
    limit: NAMED,
  })
  const count = held.data?.total ?? 0
  const named = held.data?.items.map((ticket) => ticket.identifier) ?? []
  const waiting = giveTo === 'somebody' && !personId

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm(count > 0 && giveTo === 'somebody' ? Number(personId) : undefined)
    } catch (err: unknown) {
      setError(errorDetail(err, t(`members.handover.failed.${change}`)))
      setBusy(false)
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
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="pop-in glass-strong w-full max-w-md rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          {t(`members.handover.title.${change}`, { name: person.full_name, team: team.name })}
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          {t(`members.handover.intro.${change}`, { team: team.name })}
        </p>

        {held.isPending ? (
          <p className="mt-3 text-sm text-neutral-500">{t('members.handover.counting')}</p>
        ) : count > 0 ? (
          <>
            <p className="mt-3 text-sm text-neutral-600">
              <Trans
                t={t}
                i18nKey={change === 'leave' ? 'members.handover.youHold' : 'members.handover.holds'}
                count={count}
                values={{ name: person.full_name, count }}
                components={{ strong: <strong className="font-semibold text-neutral-900" /> }}
                {...userText}
              />
            </p>

            <fieldset className="mt-3 space-y-2">
              <legend className="sr-only">{t('members.handover.legend', { count })}</legend>
              <label className="flex items-center gap-2 text-sm text-neutral-700">
                <input
                  type="radio"
                  name="give-to"
                  checked={giveTo === 'nobody'}
                  onChange={() => setGiveTo('nobody')}
                  className="h-4 w-4 accent-[var(--color-brand-600)]"
                />
                {t('members.handover.unassign', { count })}
              </label>
              <label className="flex items-center gap-2 text-sm text-neutral-700">
                <input
                  type="radio"
                  name="give-to"
                  checked={giveTo === 'somebody'}
                  onChange={() => setGiveTo('somebody')}
                  className="h-4 w-4 accent-[var(--color-brand-600)]"
                />
                {t('members.handover.reassign', { count })}
              </label>
              <div className="pl-6">
                <Select
                  block
                  value={personId}
                  disabled={giveTo !== 'somebody'}
                  onChange={(e) => setPersonId(e.target.value)}
                  aria-label={t('members.handover.choose')}
                >
                  <option value="">{t('members.handover.choose')}</option>
                  <AssigneeOptions members={members} exceptId={person.id} />
                </Select>
              </div>
            </fieldset>

            <p className="identifier mt-3 rounded-control bg-neutral-900/5 px-3 py-2 text-xs text-neutral-600">
              {named.join(' · ')}
              {count > named.length && (
                <span className="text-neutral-400">
                  {' '}
                  {t('members.handover.more', { count: count - named.length })}
                </span>
              )}
            </p>
          </>
        ) : null}

        {error && (
          <p role="alert" className="mt-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
            {t('common:cancel')}
          </button>
          <button
            type="submit"
            disabled={held.isPending || waiting || busy}
            className="btn btn-danger btn-sm"
          >
            {t(`members.handover.confirm.${change}`)}
          </button>
        </div>
      </form>
    </div>
  )
}

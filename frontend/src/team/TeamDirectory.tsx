import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type KeyboardEvent, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'

import {
  getListMyTeamsTeamsGetQueryKey,
  getTeamDirectoryTeamsDirectoryGetQueryKey,
  useAskToJoinTeamsTeamIdJoinRequestsPost,
  useJoinOpenTeamTeamsTeamIdJoinPost,
  useWithdrawJoinRequestTeamsJoinRequestsJoinRequestIdDelete,
} from '@/api/generated/endpoints/teams/teams'
import type { TeamDirectoryEntry } from '@/api/generated/models'
import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import { useTranslation } from '@/i18n'
import { formatList, formatRelative } from '@/i18n/format'
import { departmentColor } from '@/people/departmentColor'
import { Icon } from '@/ui/Icon'
import { useFocusTrap } from '@/ui/useFocusTrap'

/**
 * The teams there are (#259), each with its size and admins, and where you
 * stand with it: on it, asked to join it, free to join it, or able to ask.
 * Nothing of a team's tickets, epics or sprints -- the API sends none.
 *
 * On /teams, and on the page for somebody on no team (#318), which leads
 * with it.
 */
export function TeamDirectoryList({ teams }: { teams: TeamDirectoryEntry[] }) {
  const [asking, setAsking] = useState<TeamDirectoryEntry | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      {error && (
        <p role="alert" className="mt-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </p>
      )}
      <ul className="divide-y divide-neutral-900/8">
        {teams.map((team) => (
          <TeamDirectoryRow key={team.id} team={team} onAsk={setAsking} onError={setError} />
        ))}
      </ul>
      {asking && <AskToJoinDialog team={asking} onClose={() => setAsking(null)} />}
    </>
  )
}

/** A team's key, in a colour of its own, from its id. */
function KeyBadge({ team }: { team: TeamDirectoryEntry }) {
  const color = departmentColor(team.id)
  return (
    <span
      className="identifier flex h-10 w-14 shrink-0 items-center justify-center rounded-control text-[11px] font-semibold"
      style={{
        background: `color-mix(in oklab, ${color} 14%, transparent)`,
        color: `color-mix(in oklab, ${color} 80%, var(--color-neutral-900))`,
      }}
    >
      {team.key}
    </span>
  )
}

function TeamDirectoryRow({
  team,
  onAsk,
  onError,
}: {
  team: TeamDirectoryEntry
  onAsk: (team: TeamDirectoryEntry) => void
  onError: (error: string | null) => void
}) {
  const { t } = useTranslation('team')
  const admins = team.admins.map((admin) => admin.full_name)
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5">
      <KeyBadge team={team} />
      <div className="min-w-[12rem] flex-1">
        <p className="truncate text-sm font-medium text-neutral-900">{team.name}</p>
        {team.description && (
          <p className="truncate text-sm text-neutral-500">{team.description}</p>
        )}
        <p className="text-xs text-neutral-500">
          {t('directory.meta', {
            size: t('directory.size', { count: team.member_count }),
            admins:
              admins.length > 0
                ? t('directory.admins', { count: admins.length, names: admins.join(', ') })
                : t('directory.noAdmin'),
          })}
        </p>
      </div>
      <TeamAction team={team} onAsk={onAsk} onError={onError} />
    </li>
  )
}

function TeamAction({
  team,
  onAsk,
  onError,
}: {
  team: TeamDirectoryEntry
  onAsk: (team: TeamDirectoryEntry) => void
  onError: (error: string | null) => void
}) {
  const { t } = useTranslation('team')
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const join = useJoinOpenTeamTeamsTeamIdJoinPost()
  const withdraw = useWithdrawJoinRequestTeamsJoinRequestsJoinRequestIdDelete()

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getTeamDirectoryTeamsDirectoryGetQueryKey() })

  if (team.my_role) {
    return (
      <Link to={`/${team.key}`} className="btn btn-ghost btn-sm" title={t('directory.onIt')}>
        {t('directory.open')}
        <Icon name="chevron-right" size={14} />
      </Link>
    )
  }

  if (team.my_request) {
    const request = team.my_request
    return (
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-sm text-neutral-600">
          <Icon name="check" size={14} className="text-accent-mint" />
          {t('directory.asked', { when: formatRelative(parseServerDate(request.created_at)) })}
        </span>
        <button
          type="button"
          disabled={withdraw.isPending}
          onClick={async () => {
            onError(null)
            try {
              await withdraw.mutateAsync({ joinRequestId: request.id })
            } catch (err: unknown) {
              onError(errorDetail(err, t('directory.errors.withdraw')))
            }
            void refresh()
          }}
          className="btn btn-ghost btn-sm"
        >
          {t('directory.withdraw')}
        </button>
      </div>
    )
  }

  if (team.open_to_join) {
    return (
      <button
        type="button"
        disabled={join.isPending}
        onClick={async () => {
          onError(null)
          try {
            const joined = await join.mutateAsync({ teamId: team.id })
            await queryClient.invalidateQueries({ queryKey: getListMyTeamsTeamsGetQueryKey() })
            void refresh()
            navigate(`/${joined.key}`)
          } catch (err: unknown) {
            onError(errorDetail(err, t('directory.errors.join')))
            void refresh()
          }
        }}
        className="btn btn-primary btn-sm"
      >
        {join.isPending ? t('directory.joining') : t('directory.join')}
      </button>
    )
  }

  return (
    <button type="button" onClick={() => onAsk(team)} className="btn btn-secondary btn-sm">
      {t('directory.askToJoin')}
    </button>
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

/** Asking, with a note. The dialog names the admins who will be told. */
export function AskToJoinDialog({
  team,
  onClose,
}: {
  team: TeamDirectoryEntry
  onClose: () => void
}) {
  const { t } = useTranslation(['team', 'common'])
  const queryClient = useQueryClient()
  const ask = useAskToJoinTeamsTeamIdJoinRequestsPost()
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const noteId = useId()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const admins = team.admins.map((admin) => admin.full_name)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      await ask.mutateAsync({ teamId: team.id, data: { note: note.trim() || null } })
      void queryClient.invalidateQueries({ queryKey: getTeamDirectoryTeamsDirectoryGetQueryKey() })
      onClose()
    } catch (err: unknown) {
      setError(errorDetail(err, t('directory.dialog.error')))
    }
  }

  // Into the body: the panel it opens from is glass, whose backdrop filter
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
          {t('directory.dialog.title', { team: team.name })}
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          {admins.length > 0
            ? t('directory.dialog.notified', { count: admins.length, names: formatList(admins) })
            : t('directory.dialog.nobody')}
        </p>

        {error && (
          <div
            role="alert"
            className="mt-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </div>
        )}

        <label htmlFor={noteId} className="mb-1.5 mt-4 block text-xs font-medium text-neutral-500">
          {t('directory.dialog.note')}{' '}
          <span className="font-normal text-neutral-400">{t('directory.dialog.optional')}</span>
        </label>
        <textarea
          id={noteId}
          rows={3}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('directory.dialog.notePlaceholder')}
          className="field resize-none"
        />

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            {t('common:cancel')}
          </button>
          <button type="submit" disabled={ask.isPending} className="btn btn-primary btn-sm">
            {ask.isPending ? t('directory.dialog.sending') : t('directory.dialog.send')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

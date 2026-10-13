import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { useUpdateTeamTeamsTeamIdPatch } from '@/api/generated/endpoints/teams/teams'
import type { TeamRead } from '@/api/generated/models'
import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import { Trans, userText, useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { Icon } from '@/ui/Icon'

/**
 * Over an archived team's board, and on its tickets (#322): since when it is
 * read-only, and -- for its admins and site admins -- Unarchive, which puts
 * it back exactly as it was. Nothing else on the page offers a change.
 */
export function ArchivedBanner({
  team,
  mayUnarchive,
  compact = false,
}: {
  team: TeamRead
  mayUnarchive: boolean
  /** On a ticket: the same words, smaller, and no button. */
  compact?: boolean
}) {
  const { t } = useTranslation('team')
  const queryClient = useQueryClient()
  const updateTeam = useUpdateTeamTeamsTeamIdPatch()
  const [error, setError] = useState<string | null>(null)

  const since = team.archived_at
    ? formatDate(parseServerDate(team.archived_at), t('archived.datePattern'))
    : ''

  const unarchive = async () => {
    setError(null)
    try {
      await updateTeam.mutateAsync({ teamId: team.id, data: { archived: false } })
      await queryClient.invalidateQueries({ queryKey: ['/teams'] })
    } catch (err: unknown) {
      setError(errorDetail(err, t('archived.unarchiveFailed', { team: team.name })))
    }
  }

  return (
    <div
      role="status"
      className={`glass flex flex-wrap items-center gap-3 rounded-panel text-neutral-700 ${
        compact ? 'mb-3 px-3 py-2 text-xs' : 'px-4 py-3 text-sm'
      }`}
    >
      <Icon name="lock" size={compact ? 12 : 14} className="shrink-0 text-neutral-500" />
      <p className="min-w-0 flex-1">
        <Trans
          t={t}
          i18nKey="archived.banner"
          values={{ team: team.name, date: since }}
          {...userText}
          components={{ strong: <strong className="font-semibold text-neutral-900" /> }}
        />
      </p>
      {mayUnarchive && !compact && (
        <button
          type="button"
          onClick={() => void unarchive()}
          disabled={updateTeam.isPending}
          className="btn btn-secondary btn-sm shrink-0"
        >
          {updateTeam.isPending ? t('archived.unarchiving') : t('archived.unarchive')}
        </button>
      )}
      {error && (
        <p role="alert" className="w-full text-xs text-danger-700">
          {error}
        </p>
      )}
    </div>
  )
}

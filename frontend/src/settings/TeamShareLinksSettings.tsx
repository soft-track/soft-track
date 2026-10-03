import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router-dom'

import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import { useListProjectsTeamsTeamIdProjectsGet } from '@/api/generated/endpoints/projects/projects'
import {
  useListShareLinksTeamsTeamIdShareLinksGet,
  useRevokeShareLinkShareLinksShareLinkIdDelete,
} from '@/api/generated/endpoints/sharing/sharing'
import { useListTeamMembersTeamsTeamIdMembersGet } from '@/api/generated/endpoints/teams/teams'
import { useListViewsTeamsTeamIdViewsGet } from '@/api/generated/endpoints/views/views'
import type { ShareLinkRead, TeamRead } from '@/api/generated/models'
import { useAuth } from '@/auth/useAuth'
import { useTranslation } from '@/i18n'
import { formatDate, formatRelative } from '@/i18n/format'
import { ShareLinkDialog, type ShareTarget } from '@/sharing/ShareLinkDialog'
import { useTeamByKey } from '@/team/useTeams'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Select } from '@/ui/Select'

/**
 * Settings → a team → Share links (#245): every read-only link the team has
 * made, who made it, how often it was opened and when it stops working, with
 * Revoke. A team admin's page, as making a link is.
 */
export default function TeamShareLinksSettings() {
  const { teamKey } = useParams()
  const { team, isLoading } = useTeamByKey(teamKey)
  const { user } = useAuth()
  const { t } = useTranslation(['sharing', 'common'])
  const members = useListTeamMembersTeamsTeamIdMembersGet(team?.id ?? 0, {
    query: { enabled: Boolean(team) },
  })
  const isAdmin =
    members.data?.some((member) => member.user.id === user?.id && member.role === 'admin') ??
    false

  if (isLoading || members.isPending) return <Loading />
  if (!team) {
    return (
      <div className="glass-strong rounded-panel p-6 text-sm text-neutral-500">
        {t('common:teamNotFound')}
      </div>
    )
  }
  if (!isAdmin) {
    return (
      <div className="glass-strong rounded-panel p-6">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
          {t('settings.title')}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">{t('settings.adminsOnly')}</p>
      </div>
    )
  }
  return <ShareLinks key={team.id} team={team} />
}

function ShareLinks({ team }: { team: TeamRead }) {
  const { t } = useTranslation(['sharing', 'common'])
  const queryClient = useQueryClient()
  const links = useListShareLinksTeamsTeamIdShareLinksGet(team.id)
  const epics = useListProjectsTeamsTeamIdProjectsGet(team.id)
  const views = useListViewsTeamsTeamIdViewsGet(team.id)
  const revoke = useRevokeShareLinkShareLinksShareLinkIdDelete()

  const [choice, setChoice] = useState('')
  const [sharing, setSharing] = useState<ShareTarget | null>(null)
  const [error, setError] = useState<string | null>(null)

  const liveEpics = (epics.data ?? []).filter((epic) => !epic.archived)
  const sharedViews = (views.data?.items ?? []).filter((view) => view.is_shared)

  const onNext = () => {
    const [kind, id] = choice.split(':')
    if (kind === 'epic') {
      const epic = liveEpics.find((e) => e.id === Number(id))
      if (epic) setSharing({ kind: 'epic', id: epic.id, name: epic.name })
    } else if (kind === 'view') {
      const view = sharedViews.find((v) => v.id === Number(id))
      if (view) setSharing({ kind: 'view', id: view.id, name: view.name })
    }
  }

  const onRevoke = async (link: ShareLinkRead) => {
    if (!window.confirm(t('settings.confirmRevoke'))) return
    setError(null)
    try {
      await revoke.mutateAsync({ shareLinkId: link.id })
      queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/share-links`] })
    } catch (err: unknown) {
      setError(errorDetail(err, t('settings.failed')))
    }
  }

  return (
    <div className="space-y-4">
      <div className="glass-strong sheen rounded-panel p-6">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
          {t('settings.title')}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">{t('settings.intro')}</p>
        <div className="mt-5 flex flex-wrap items-end gap-2">
          <label className="min-w-[16rem] flex-1">
            <span className="mb-1.5 block text-xs font-medium text-neutral-500">
              {t('settings.what')}
            </span>
            <Select block value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="">{t('settings.choose')}</option>
              {liveEpics.map((epic) => (
                <option key={`epic:${epic.id}`} value={`epic:${epic.id}`}>
                  {t('settings.chooseEpic', { name: epic.name })}
                </option>
              ))}
              {sharedViews.map((view) => (
                <option key={`view:${view.id}`} value={`view:${view.id}`}>
                  {t('settings.chooseView', { name: view.name })}
                </option>
              ))}
            </Select>
          </label>
          <button type="button" disabled={!choice} onClick={onNext} className="btn btn-primary">
            <Icon name="link" size={15} />
            {t('settings.newLink')}
          </button>
        </div>
      </div>

      <section className="glass-strong rounded-panel p-6">
        {error && (
          <p role="alert" className="mb-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {error}
          </p>
        )}
        {links.isPending ? (
          <Loading />
        ) : (links.data ?? []).length === 0 ? (
          <p className="text-sm text-neutral-400">{t('settings.empty')}</p>
        ) : (
          <ul className="divide-y divide-neutral-900/8">
            {(links.data ?? []).map((link) => (
              <LinkRow key={link.id} link={link} onRevoke={() => onRevoke(link)} />
            ))}
          </ul>
        )}
      </section>

      {sharing && (
        <ShareLinkDialog
          teamId={team.id}
          target={sharing}
          onClose={() => {
            setSharing(null)
            setChoice('')
          }}
        />
      )}
    </div>
  )
}

function LinkRow({ link, onRevoke }: { link: ShareLinkRead; onRevoke: () => void }) {
  const { t } = useTranslation(['sharing', 'common'])
  const when = (value: string) => formatDate(parseServerDate(value), 'd MMM yyyy')
  const name =
    link.target_name == null
      ? t('settings.gone')
      : link.kind === 'view'
        ? t('settings.viewPrefix', { name: link.target_name })
        : link.target_name
  // Inactive, not revoked and with a date: it is the date that stopped it.
  const expired = !link.active && !link.revoked_at && link.expires_at != null

  const facts = [
    t('settings.by', { name: link.created_by.full_name }),
    link.last_opened_at
      ? t('settings.opened', {
          count: link.open_count,
          when: formatRelative(parseServerDate(link.last_opened_at)),
        })
      : t('settings.neverOpened'),
  ]
  const terms = [
    link.revoked_at
      ? t('settings.revokedOn', { date: when(link.revoked_at) })
      : link.expires_at
        ? t(expired ? 'settings.expiredOn' : 'settings.expiresOn', { date: when(link.expires_at) })
        : t('settings.neverExpires'),
    link.has_password && t('settings.password'),
  ].filter(Boolean)

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <Icon name="link" size={16} className="text-neutral-400" />
      <div className="min-w-[14rem] flex-1">
        <p className={`text-sm font-medium ${link.active ? 'text-neutral-900' : 'text-neutral-400'}`}>
          {name}
        </p>
        <p className="text-xs text-neutral-500">{facts.join(' · ')}</p>
        <p className="text-xs text-neutral-400">{terms.join(' · ')}</p>
      </div>
      {link.revoked_at ? (
        <span className="chip" style={{ ['--chip' as string]: 'var(--color-neutral-400)' }}>
          {t('settings.revoked')}
        </span>
      ) : (
        <button type="button" onClick={onRevoke} className="btn btn-danger-ghost btn-sm">
          {t('settings.revoke')}
        </button>
      )}
    </li>
  )
}

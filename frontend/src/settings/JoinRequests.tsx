import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  getListJoinRequestsTeamsTeamIdJoinRequestsGetQueryKey,
  getListTeamMembersTeamsTeamIdMembersGetQueryKey,
  useApproveJoinRequestTeamsTeamIdJoinRequestsJoinRequestIdApprovePost,
  useDeclineJoinRequestTeamsTeamIdJoinRequestsJoinRequestIdDeclinePost,
  useListJoinRequestsTeamsTeamIdJoinRequestsGet,
} from '@/api/generated/endpoints/teams/teams'
import type { JoinRequestRead, TeamRole } from '@/api/generated/models'
import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import { useTranslation } from '@/i18n'
import { formatRelative } from '@/i18n/format'
import { ROLE_HINTS, ROLE_LABELS } from '@/settings/roles'
import { Avatar } from '@/ui/Avatar'
import { ExternalChip } from '@/ui/ExternalChip'
import { Select } from '@/ui/Select'

/**
 * People asking to join the team (#259), for its admins: who is asking, with
 * their title, department and manager beside the request so the admin knows
 * who they are, the note they left, a role to give, and Approve or Decline.
 * Nothing at all while nobody is asking.
 */
export function JoinRequests({ teamId }: { teamId: number }) {
  const { t } = useTranslation(['settings', 'common'])
  const requests = useListJoinRequestsTeamsTeamIdJoinRequestsGet(teamId)
  const [error, setError] = useState<string | null>(null)

  const waiting = requests.data ?? []
  if (waiting.length === 0) return null

  return (
    <section className="glass-strong rounded-panel p-6">
      <p className="eyebrow mb-3">{t('members.asking.heading', { count: waiting.length })}</p>
      {error && (
        <p role="alert" className="mb-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </p>
      )}
      <ul className="divide-y divide-neutral-900/8">
        {waiting.map((request) => (
          <JoinRequestRow key={request.id} request={request} teamId={teamId} onError={setError} />
        ))}
      </ul>
    </section>
  )
}

function JoinRequestRow({
  request,
  teamId,
  onError,
}: {
  request: JoinRequestRead
  teamId: number
  onError: (error: string | null) => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const queryClient = useQueryClient()
  const approve = useApproveJoinRequestTeamsTeamIdJoinRequestsJoinRequestIdApprovePost()
  const decline = useDeclineJoinRequestTeamsTeamIdJoinRequestsJoinRequestIdDeclinePost()
  const person = request.requester
  // Somebody from outside the organisation is only ever a guest (#243).
  const [role, setRole] = useState<TeamRole>(person.is_external ? 'guest' : 'member')
  const busy = approve.isPending || decline.isPending

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: getListJoinRequestsTeamsTeamIdJoinRequestsGetQueryKey(teamId),
    })
    void queryClient.invalidateQueries({
      queryKey: getListTeamMembersTeamsTeamIdMembersGetQueryKey(teamId),
    })
  }

  const decide = async (approving: boolean) => {
    onError(null)
    try {
      if (approving) {
        await approve.mutateAsync({ teamId, joinRequestId: request.id, data: { role } })
      } else {
        await decline.mutateAsync({ teamId, joinRequestId: request.id })
      }
    } catch (err: unknown) {
      onError(errorDetail(err, t(approving ? 'members.errors.approve' : 'members.errors.decline')))
    }
    refresh()
  }

  const about = [
    request.job_title,
    request.department,
    request.manager ? t('members.asking.reportsTo', { name: request.manager.full_name }) : null,
  ].filter(Boolean)

  return (
    <li className="flex gap-3 py-3">
      <Avatar user={person} size={34} decorative />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-neutral-900">
          {person.full_name}
          <span className="identifier text-xs font-normal text-neutral-400">@{person.username}</span>
          {person.is_external && <ExternalChip />}
        </p>
        {about.length > 0 && <p className="text-xs text-neutral-500">{about.join(' · ')}</p>}
        {request.note && (
          <p className="well mt-2 rounded-control px-3 py-2 text-sm text-neutral-700">
            {t('members.asking.note', { note: request.note })}
          </p>
        )}
        <p className="mt-1 text-xs text-neutral-400">
          {t('members.asking.expires', {
            asked: formatRelative(parseServerDate(request.created_at)),
            when: formatRelative(parseServerDate(request.expires_at)),
          })}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select
            dense
            value={role}
            onChange={(e) => setRole(e.target.value as TeamRole)}
            aria-label={t('members.asking.roleFor', { name: person.full_name })}
            title={ROLE_HINTS[role]}
            disabled={busy || person.is_external}
          >
            {(['admin', 'member', 'guest'] as const).map((option) => (
              <option key={option} value={option}>
                {ROLE_LABELS[option]}
              </option>
            ))}
          </Select>
          <button
            type="button"
            onClick={() => decide(true)}
            disabled={busy}
            className="btn btn-primary btn-sm"
          >
            {t('members.asking.approve')}
          </button>
          <button
            type="button"
            onClick={() => decide(false)}
            disabled={busy}
            className="btn btn-ghost btn-sm"
          >
            {t('members.asking.decline')}
          </button>
        </div>
      </div>
    </li>
  )
}

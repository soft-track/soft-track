import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import {
  useCreateInviteTeamsTeamIdInvitesPost,
  useListInvitesTeamsTeamIdInvitesGet,
  useRevokeInviteTeamsTeamIdInvitesInviteIdDelete,
} from '@/api/generated/endpoints/invites/invites'
import { useGetNotificationSettingsNotificationsSettingsGet } from '@/api/generated/endpoints/notifications/notifications'
import {
  useListTeamMembersTeamsTeamIdMembersGet,
  useRemoveTeamMemberTeamsTeamIdMembersUserIdDelete,
  useUpdateTeamMemberRoleTeamsTeamIdMembersUserIdPatch,
} from '@/api/generated/endpoints/teams/teams'
import type { InviteRead, TeamRole } from '@/api/generated/models'
import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/useAuth'
import { Trans, userText, useTranslation } from '@/i18n'
import { formatRelative } from '@/i18n/format'
import { DeactivatedChip, RoleChip } from '@/settings/RoleChip'
import { ROLE_HINTS, ROLE_LABELS } from '@/settings/roles'
import { copyInviteLink, inviteUrl } from '@/settings/inviteLink'
import { useTeamByKey } from '@/team/useTeams'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Select } from '@/ui/Select'

export default function TeamMembersSettings() {
  const { teamKey } = useParams()
  const { team, isLoading } = useTeamByKey(teamKey)
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { t } = useTranslation(['settings', 'common'])

  const teamId = team?.id ?? 0
  const enabled = { query: { enabled: Boolean(team) } }

  const members = useListTeamMembersTeamsTeamIdMembersGet(teamId, enabled)
  const isAdmin =
    members.data?.some((m) => m.user.id === user?.id && m.role === 'admin') ?? false

  // Only an admin may read the pending list, so asking as a member would be a
  // guaranteed 403 in the console.
  const invites = useListInvitesTeamsTeamIdInvitesGet(teamId, {
    query: { enabled: Boolean(team) && isAdmin },
  })

  const createInvite = useCreateInviteTeamsTeamIdInvitesPost()
  const revokeInvite = useRevokeInviteTeamsTeamIdInvitesInviteIdDelete()
  const updateRole = useUpdateTeamMemberRoleTeamsTeamIdMembersUserIdPatch()
  const removeMember = useRemoveTeamMemberTeamsTeamIdMembersUserIdDelete()

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<TeamRole>('member')
  const [lastInvite, setLastInvite] = useState<InviteRead | null>(null)
  // Whether this instance can send mail at all (#84). The same answer the
  // notification settings use to decide whether to offer email digests.
  const canEmail =
    useGetNotificationSettingsNotificationsSettingsGet().data?.email_delivery_configured === true
  // On by default where it is possible: someone who typed an address expects
  // the invitation to reach it. Copying the link still works either way.
  const [emailIt, setEmailIt] = useState(true)
  const [copied, setCopied] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (isLoading) return <Loading />
  if (!team) {
    return (
      <div className="glass-strong rounded-panel p-6 text-sm text-neutral-500">
        {t('common:teamNotFound')}
      </div>
    )
  }

  const refreshMembers = () => {
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/members`] })
  }
  const refreshInvites = () => {
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/invites`] })
  }

  const onInvite = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      const invite = await createInvite.mutateAsync({
        teamId: team.id,
        data: { email: inviteEmail, role: inviteRole, send_email: canEmail && emailIt },
      })
      setLastInvite(invite)
      setInviteEmail('')
      refreshInvites()
    } catch (err: unknown) {
      setError(errorDetail(err, t('members.errors.invite')))
    }
  }

  const onCopy = async (invite: InviteRead) => {
    const ok = await copyInviteLink(invite.token)
    setCopied(ok ? invite.id : null)
    if (!ok) setError(t('members.errors.clipboard', { link: inviteUrl(invite.token) }))
    else window.setTimeout(() => setCopied(null), 2000)
  }

  const onRoleChange = async (userId: number, role: TeamRole) => {
    setError(null)
    try {
      await updateRole.mutateAsync({ teamId: team.id, userId, data: { role } })
      refreshMembers()
    } catch (err: unknown) {
      setError(errorDetail(err, t('members.errors.role')))
    }
  }

  const onRemove = async (userId: number, name: string) => {
    const leaving = userId === user?.id
    const question = leaving
      ? t('members.confirm.leave', { team: team.name })
      : t('members.confirm.remove', { name, team: team.name })
    if (!window.confirm(question)) return

    setError(null)
    try {
      await removeMember.mutateAsync({ teamId: team.id, userId })
      if (leaving) {
        queryClient.invalidateQueries({ queryKey: ['/teams'] })
        navigate('/')
        return
      }
      refreshMembers()
    } catch (err: unknown) {
      setError(errorDetail(err, t('members.errors.remove')))
    }
  }

  const onRevoke = async (invite: InviteRead) => {
    if (!window.confirm(t('members.confirm.revoke', { email: invite.email }))) return
    setError(null)
    try {
      await revokeInvite.mutateAsync({ teamId: team.id, inviteId: invite.id })
      if (lastInvite?.id === invite.id) setLastInvite(null)
      refreshInvites()
    } catch (err: unknown) {
      setError(errorDetail(err, t('members.errors.revoke')))
    }
  }

  return (
    <div className="space-y-4">
      <div className="glass-strong sheen rounded-panel p-6">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
          {t('members.title', { team: team.name })}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {isAdmin ? t('members.introAdmin') : t('members.introMember')}
        </p>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </div>
        )}

        {isAdmin && (
          <form onSubmit={onInvite} className="mt-5 flex flex-wrap items-end gap-2">
            <label className="min-w-[16rem] flex-1">
              <span className="mb-1.5 block text-xs font-medium text-neutral-500">
                {t('members.invite.emailLabel')}
              </span>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="field"
                placeholder={t('members.invite.emailPlaceholder')}
              />
            </label>
            <Select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as TeamRole)}
              aria-label={t('members.invite.roleLabel')}
              title={ROLE_HINTS[inviteRole]}
            >
              <RoleOptions />
            </Select>
            <button type="submit" disabled={createInvite.isPending} className="btn btn-primary">
              <Icon name="mail" size={15} />
              {createInvite.isPending ? t('members.invite.sending') : t('members.invite.send')}
            </button>
            {canEmail && (
              <label className="flex w-full items-center gap-2 text-sm text-neutral-600">
                <input
                  type="checkbox"
                  checked={emailIt}
                  onChange={(e) => setEmailIt(e.target.checked)}
                  className="h-4 w-4 accent-[var(--color-brand-600)]"
                />
                {t('members.invite.emailIt')}
              </label>
            )}
          </form>
        )}

        {lastInvite && (
          <div className="well mt-4 rounded-control p-3">
            <p className="text-sm text-neutral-700">
              <Trans
                t={t}
                i18nKey={
                  lastInvite.emailed_at
                    ? 'members.lastInvite.emailed'
                    : canEmail
                      ? 'members.lastInvite.ready'
                      : 'members.lastInvite.readyNoEmail'
                }
                values={{ email: lastInvite.email }}
                {...userText}
                components={{ strong: <strong /> }}
              />
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="identifier min-w-0 flex-1 truncate rounded-control bg-neutral-900/5 px-2 py-1.5 text-xs text-neutral-600">
                {inviteUrl(lastInvite.token)}
              </code>
              <button
                type="button"
                onClick={() => onCopy(lastInvite)}
                className="btn btn-secondary btn-sm"
              >
                <Icon name={copied === lastInvite.id ? 'check' : 'copy'} size={14} />
                {copied === lastInvite.id ? t('common:copied') : t('members.copyLink')}
              </button>
            </div>
          </div>
        )}
      </div>

      <section className="glass-strong rounded-panel p-6">
        <p className="eyebrow mb-3">
          {members.data
            ? t('members.list.headingCount', { total: members.data.length })
            : t('members.list.heading')}
        </p>
        {members.isPending && <Loading label={t('members.list.loading')} />}
        <ul className="divide-y divide-neutral-900/8">
          {(members.data ?? []).map((member) => (
            <li key={member.user.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
              <Avatar user={member.user} size={34} inactive={!member.user.is_active} decorative />
              <div className="min-w-[14rem] flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-neutral-900">
                  {member.user.full_name}
                  <span className="identifier text-xs font-normal text-neutral-400">
                    @{member.user.username}
                  </span>
                  {!member.user.is_active && <DeactivatedChip />}
                </p>
                <p className="text-xs text-neutral-400">
                  {t('members.list.emailJoined', {
                    email: member.user.email,
                    when: formatRelative(parseServerDate(member.joined_at)),
                  })}
                </p>
              </div>

              {isAdmin ? (
                <Select
                  dense
                  value={member.role}
                  onChange={(e) => onRoleChange(member.user.id, e.target.value as TeamRole)}
                  aria-label={t('members.list.roleFor', { name: member.user.full_name })}
                  title={ROLE_HINTS[member.role]}
                >
                  <RoleOptions />
                </Select>
              ) : (
                <RoleChip role={member.role} />
              )}

              {(isAdmin || member.user.id === user?.id) && (
                <button
                  type="button"
                  onClick={() => onRemove(member.user.id, member.user.full_name)}
                  className="btn btn-danger-ghost btn-sm"
                >
                  {member.user.id === user?.id ? t('members.list.leave') : t('common:remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {isAdmin && (
        <section className="glass-strong rounded-panel p-6">
          <p className="eyebrow mb-3">{t('members.pending.heading')}</p>
          {(invites.data ?? []).length === 0 ? (
            <p className="text-sm text-neutral-400">
              {t('members.pending.empty')}
            </p>
          ) : (
            <ul className="divide-y divide-neutral-900/8">
              {(invites.data ?? []).map((invite) => (
                <li key={invite.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <Icon name="mail" size={16} className="text-neutral-400" />
                  <div className="min-w-[14rem] flex-1">
                    <p className="truncate text-sm font-medium text-neutral-900">
                      {invite.email}
                    </p>
                    <p className="text-xs text-neutral-400">
                      {t('members.pending.invitedBy', {
                        name: invite.invited_by.full_name,
                        when: formatRelative(parseServerDate(invite.expires_at)),
                      })}
                    </p>
                    {/* Attempted, not delivered: SMTP accepting the message
                        is all this instance can know. */}
                    {invite.emailed_at && (
                      <p className="text-xs text-neutral-500">
                        {t('members.pending.sentTo', {
                          email: invite.email,
                          when: formatRelative(parseServerDate(invite.emailed_at)),
                        })}
                      </p>
                    )}
                  </div>
                  <RoleChip role={invite.role} />
                  <button
                    type="button"
                    onClick={() => onCopy(invite)}
                    className="btn btn-ghost btn-sm"
                  >
                    <Icon name={copied === invite.id ? 'check' : 'copy'} size={14} />
                    {copied === invite.id ? t('common:copied') : t('members.copyLink')}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      createInvite
                        .mutateAsync({
                          teamId: team.id,
                          // Resent the way it was first sent: by email if it
                          // was emailed, as a fresh link to copy if not.
                          data: {
                            email: invite.email,
                            role: invite.role,
                            send_email: canEmail && invite.emailed_at != null,
                          },
                        })
                        .then((fresh) => {
                          // Re-inviting mints a new token and retires the old
                          // one, so the link on screen has to be replaced too.
                          setLastInvite(fresh)
                          refreshInvites()
                        })
                        .catch((err: unknown) =>
                          setError(errorDetail(err, t('members.errors.resend'))),
                        )
                    }
                    className="btn btn-ghost btn-sm"
                  >
                    {t('members.pending.resend')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRevoke(invite)}
                    className="btn btn-danger-ghost btn-sm"
                  >
                    <Icon name="trash" size={14} />
                    {t('members.pending.revoke')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

/** Most access first, so the choice reads as a scale. */
function RoleOptions() {
  return (
    <>
      {(['admin', 'member', 'guest'] as const).map((role) => (
        <option key={role} value={role}>
          {ROLE_LABELS[role]}
        </option>
      ))}
    </>
  )
}

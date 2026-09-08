import { useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { type FormEvent, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import {
  useCreateInviteTeamsTeamIdInvitesPost,
  useListInvitesTeamsTeamIdInvitesGet,
  useRevokeInviteTeamsTeamIdInvitesInviteIdDelete,
} from '@/api/generated/endpoints/invites/invites'
import {
  useListTeamMembersTeamsTeamIdMembersGet,
  useRemoveTeamMemberTeamsTeamIdMembersUserIdDelete,
  useUpdateTeamMemberRoleTeamsTeamIdMembersUserIdPatch,
} from '@/api/generated/endpoints/teams/teams'
import type { InviteRead, TeamRole } from '@/api/generated/models'
import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/AuthContext'
import { DeactivatedChip, RoleChip } from '@/settings/RoleChip'
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
  const [copied, setCopied] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (isLoading) return <Loading />
  if (!team) {
    return (
      <div className="glass-strong rounded-panel p-6 text-sm text-neutral-500">
        That team does not exist, or you are not a member of it.
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
        data: { email: inviteEmail, role: inviteRole },
      })
      setLastInvite(invite)
      setInviteEmail('')
      refreshInvites()
    } catch (err: unknown) {
      setError(errorDetail(err, 'Could not send that invitation.'))
    }
  }

  const onCopy = async (invite: InviteRead) => {
    const ok = await copyInviteLink(invite.token)
    setCopied(ok ? invite.id : null)
    if (!ok) setError(`Could not reach the clipboard. The link is ${inviteUrl(invite.token)}`)
    else window.setTimeout(() => setCopied(null), 2000)
  }

  const onRoleChange = async (userId: number, role: TeamRole) => {
    setError(null)
    try {
      await updateRole.mutateAsync({ teamId: team.id, userId, data: { role } })
      refreshMembers()
    } catch (err: unknown) {
      setError(errorDetail(err, 'Could not change that role.'))
    }
  }

  const onRemove = async (userId: number, name: string) => {
    const leaving = userId === user?.id
    const question = leaving
      ? `Leave ${team.name}? You will lose access to its issues.`
      : `Remove ${name} from ${team.name}? Their issues stay assigned to them.`
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
      setError(errorDetail(err, 'Could not remove that member.'))
    }
  }

  const onRevoke = async (invite: InviteRead) => {
    if (!window.confirm(`Revoke the invitation to ${invite.email}?`)) return
    setError(null)
    try {
      await revokeInvite.mutateAsync({ teamId: team.id, inviteId: invite.id })
      if (lastInvite?.id === invite.id) setLastInvite(null)
      refreshInvites()
    } catch (err: unknown) {
      setError(errorDetail(err, 'Could not revoke that invitation.'))
    }
  }

  return (
    <div className="space-y-4">
      <div className="glass-strong sheen rounded-panel p-6">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
          {team.name} members
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {isAdmin
            ? 'Admins can invite people, change roles and remove members.'
            : 'Only admins of this team can change who is in it.'}
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
                Invite by email
              </span>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="field"
                placeholder="colleague@example.com"
              />
            </label>
            <Select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as TeamRole)}
              aria-label="Invited role"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Select>
            <button type="submit" disabled={createInvite.isPending} className="btn btn-primary">
              <Icon name="mail" size={15} />
              {createInvite.isPending ? 'Inviting…' : 'Send invite'}
            </button>
          </form>
        )}

        {lastInvite && (
          <div className="well mt-4 rounded-control p-3">
            <p className="text-sm text-neutral-700">
              Invitation ready for <strong>{lastInvite.email}</strong>. SoftTrack does not
              send email — copy this link and send it however your team already talks.
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
                {copied === lastInvite.id ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </div>
        )}
      </div>

      <section className="glass-strong rounded-panel p-6">
        <p className="eyebrow mb-3">
          Members {members.data ? `· ${members.data.length}` : ''}
        </p>
        {members.isPending && <Loading label="Loading members…" />}
        <ul className="divide-y divide-neutral-900/8">
          {(members.data ?? []).map((member) => (
            <li key={member.user.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
              <Avatar user={member.user} size={34} inactive={!member.user.is_active} />
              <div className="min-w-[14rem] flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-neutral-900">
                  {member.user.full_name}
                  <span className="identifier text-xs font-normal text-neutral-400">
                    @{member.user.username}
                  </span>
                  {!member.user.is_active && <DeactivatedChip />}
                </p>
                <p className="text-xs text-neutral-400">
                  {member.user.email} · joined{' '}
                  {formatDistanceToNow(parseServerDate(member.joined_at), { addSuffix: true })}
                </p>
              </div>

              {isAdmin ? (
                <Select
                  dense
                  value={member.role}
                  onChange={(e) => onRoleChange(member.user.id, e.target.value as TeamRole)}
                  aria-label={`Role for ${member.user.full_name}`}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
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
                  {member.user.id === user?.id ? 'Leave' : 'Remove'}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {isAdmin && (
        <section className="glass-strong rounded-panel p-6">
          <p className="eyebrow mb-3">Pending invitations</p>
          {(invites.data ?? []).length === 0 ? (
            <p className="text-sm text-neutral-400">
              Nobody is waiting on an invitation to this team.
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
                      Invited by {invite.invited_by.full_name} · expires{' '}
                      {formatDistanceToNow(parseServerDate(invite.expires_at), { addSuffix: true })}
                    </p>
                  </div>
                  <RoleChip role={invite.role} />
                  <button
                    type="button"
                    onClick={() => onCopy(invite)}
                    className="btn btn-ghost btn-sm"
                  >
                    <Icon name={copied === invite.id ? 'check' : 'copy'} size={14} />
                    {copied === invite.id ? 'Copied' : 'Copy link'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      createInvite
                        .mutateAsync({
                          teamId: team.id,
                          data: { email: invite.email, role: invite.role },
                        })
                        .then((fresh) => {
                          // Re-inviting mints a new token and retires the old
                          // one, so the link on screen has to be replaced too.
                          setLastInvite(fresh)
                          refreshInvites()
                        })
                        .catch((err: unknown) =>
                          setError(errorDetail(err, 'Could not resend that invitation.')),
                        )
                    }
                    className="btn btn-ghost btn-sm"
                  >
                    Resend
                  </button>
                  <button
                    type="button"
                    onClick={() => onRevoke(invite)}
                    className="btn btn-danger-ghost btn-sm"
                  >
                    <Icon name="trash" size={14} />
                    Revoke
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

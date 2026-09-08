import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { useMyInvitesAuthMeInvitesGet } from '@/api/generated/endpoints/auth/auth'
import {
  useAcceptInviteInvitesTokenAcceptPost,
  useDeclineInviteInvitesTokenDeclinePost,
} from '@/api/generated/endpoints/invites/invites'
import { Icon } from '@/ui/Icon'

/**
 * Invitations waiting for the signed-in user, wherever they are in the app.
 *
 * There is no email, so this is the only thing that tells someone an
 * invitation exists once they already have an account -- without it a person
 * invited to a second team would never find out.
 */
export function InvitesBanner({ compact = false }: { compact?: boolean }) {
  const invites = useMyInvitesAuthMeInvitesGet({ query: { staleTime: 30_000 } })
  const accept = useAcceptInviteInvitesTokenAcceptPost()
  const decline = useDeclineInviteInvitesTokenDeclinePost()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const pending = invites.data ?? []
  if (pending.length === 0) return null

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['/auth/me/invites'] }),
      // `refetchType: 'all'` so the team list is refreshed even where nothing
      // is currently observing it, and awaited before navigating: the board
      // bounces an unknown key back to the first team, so arriving there with
      // a stale list would send you straight back where you came from.
      queryClient.invalidateQueries({ queryKey: ['/teams'], refetchType: 'all' }),
    ])

  const onAccept = async (token: string) => {
    const team = await accept.mutateAsync({ token })
    await refresh()
    navigate(`/${team.key}`)
  }

  const onDecline = async (token: string) => {
    await decline.mutateAsync({ token })
    await refresh()
  }

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      {!compact && <p className="eyebrow">Invitations</p>}
      {pending.map((invite) => (
        <div
          key={invite.id}
          className={`well rounded-control ${compact ? 'p-2' : 'p-3'}`}
        >
          <p
            className={`flex items-start gap-1.5 ${
              compact ? 'text-[11px] leading-snug' : 'text-sm'
            } text-neutral-700`}
          >
            <Icon
              name="mail"
              size={compact ? 12 : 15}
              className="mt-0.5 shrink-0 text-neutral-400"
            />
            <span>
              <strong>{invite.invited_by.full_name}</strong> invited you to{' '}
              <strong>{invite.team_name}</strong>
              {compact ? '' : ` (${invite.team_key}) as ${invite.role}`}
            </span>
          </p>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => onAccept(invite.token)}
              disabled={accept.isPending}
              className="btn btn-primary btn-sm"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => onDecline(invite.token)}
              disabled={decline.isPending}
              className="btn btn-ghost btn-sm"
            >
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

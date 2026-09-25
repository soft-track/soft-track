import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { useMyInvitesAuthMeInvitesGet } from '@/api/generated/endpoints/auth/auth'
import {
  useAcceptInviteInvitesTokenAcceptPost,
  useDeclineInviteInvitesTokenDeclinePost,
} from '@/api/generated/endpoints/invites/invites'
import { Trans, userText, useTranslation } from '@/i18n'
import { ROLE_LABELS } from '@/settings/roles'
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
  const { t } = useTranslation(['team', 'common'])

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
      {!compact && <p className="eyebrow">{t('invites.heading')}</p>}
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
              <Trans
                t={t}
                i18nKey={
                  compact ? ('invites.invitedCompact' as const) : ('invites.invited' as const)
                }
                values={{
                  inviter: invite.invited_by.full_name,
                  team: invite.team_name,
                  key: invite.team_key,
                  role: ROLE_LABELS[invite.role],
                }}
                {...userText}
                components={{ strong: <strong /> }}
              />
            </span>
          </p>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => onAccept(invite.token)}
              disabled={accept.isPending}
              className="btn btn-primary btn-sm"
            >
              {t('invites.accept')}
            </button>
            <button
              type="button"
              onClick={() => onDecline(invite.token)}
              disabled={decline.isPending}
              className="btn btn-ghost btn-sm"
            >
              {t('invites.decline')}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

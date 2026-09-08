import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import {
  useAcceptInviteInvitesTokenAcceptPost,
  useDeclineInviteInvitesTokenDeclinePost,
  usePreviewInviteInvitesTokenGet,
} from '@/api/generated/endpoints/invites/invites'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/AuthContext'
import { RoleChip } from '@/settings/RoleChip'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Logo } from '@/ui/Logo'

/**
 * The landing page for an invitation link.
 *
 * Outside RequireAuth on purpose: most people opening one of these links have
 * no account yet, and bouncing them to /login without saying what they were
 * invited to is how an invitation gets ignored.
 */
export default function InvitePage() {
  const { token = '' } = useParams()
  const { isAuthenticated, user, logout } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const preview = usePreviewInviteInvitesTokenGet(token)
  const accept = useAcceptInviteInvitesTokenAcceptPost()
  const decline = useDeclineInviteInvitesTokenDeclinePost()
  const [error, setError] = useState<string | null>(null)

  if (preview.isPending) {
    return (
      <div className="h-screen">
        <Loading label="Checking your invitation…" />
      </div>
    )
  }

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="pop-in w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo size={52} />
        </div>
        <div className="glass-strong sheen rounded-panel p-6">{children}</div>
      </div>
    </div>
  )

  if (preview.isError || !preview.data) {
    return shell(
      <div className="text-center">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
          This invitation is no longer valid
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          It may have been used, revoked, or simply run out. Ask whoever invited you to
          send a fresh link.
        </p>
        <Link to="/login" className="btn btn-secondary mt-5">
          Go to sign in
        </Link>
      </div>,
    )
  }

  const invite = preview.data
  const wrongAccount =
    isAuthenticated && user && user.email.toLowerCase() !== invite.email.toLowerCase()

  const onAccept = async () => {
    setError(null)
    try {
      const team = await accept.mutateAsync({ token })
      // Awaited, and `refetchType: 'all'`: the board sends an unknown team key
      // back to the first team, so navigating before the list has caught up
      // would drop the person somewhere other than the team they just joined.
      await queryClient.invalidateQueries({
        queryKey: ['/teams'],
        refetchType: 'all',
      })
      navigate(`/${team.key}`, { replace: true })
    } catch (err: unknown) {
      setError(errorDetail(err, 'Could not accept this invitation.'))
    }
  }

  const onDecline = async () => {
    setError(null)
    try {
      await decline.mutateAsync({ token })
      navigate('/', { replace: true })
    } catch (err: unknown) {
      setError(errorDetail(err, 'Could not decline this invitation.'))
    }
  }

  return shell(
    <>
      <p className="eyebrow mb-2">Invitation</p>
      <h1 className="text-lg font-semibold leading-snug tracking-tight text-neutral-900">
        {invite.invited_by_name} invited you to join{' '}
        <span className="text-gradient">{invite.team_name}</span>
      </h1>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-neutral-500">
        <span className="identifier well rounded-control px-2 py-1 text-xs">
          {invite.team_key}
        </span>
        <span>as</span>
        <RoleChip role={invite.role} />
      </div>
      <p className="mt-3 text-sm text-neutral-500">
        Sent to <strong className="text-neutral-700">{invite.email}</strong>.
      </p>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
        >
          {error}
        </div>
      )}

      {!isAuthenticated && (
        <div className="mt-6 space-y-2">
          <Link
            to={`/register?invite=${encodeURIComponent(token)}`}
            className="btn btn-primary h-10 w-full text-sm"
          >
            Create an account
          </Link>
          <Link
            to={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
            className="btn btn-secondary h-10 w-full text-sm"
          >
            Sign in to accept
          </Link>
        </div>
      )}

      {wrongAccount && (
        <div className="well mt-6 rounded-control p-3">
          <p className="text-sm text-neutral-700">
            You are signed in as <strong>{user?.email}</strong>, and this invitation was
            sent to <strong>{invite.email}</strong>. An invitation only admits the address
            it was addressed to.
          </p>
          <button type="button" onClick={logout} className="btn btn-secondary btn-sm mt-3">
            <Icon name="logout" size={14} />
            Sign out and use the other account
          </button>
        </div>
      )}

      {isAuthenticated && !wrongAccount && (
        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={onAccept}
            disabled={accept.isPending}
            className="btn btn-primary h-10 flex-1 text-sm"
          >
            {accept.isPending ? 'Joining…' : `Join ${invite.team_name}`}
          </button>
          <button
            type="button"
            onClick={onDecline}
            disabled={decline.isPending}
            className="btn btn-ghost h-10 text-sm"
          >
            Decline
          </button>
        </div>
      )}
    </>,
  )
}

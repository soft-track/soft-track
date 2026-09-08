import { Link, Navigate } from 'react-router-dom'

import { useMyInvitesAuthMeInvitesGet } from '@/api/generated/endpoints/auth/auth'
import { InvitesBanner } from '@/team/InvitesBanner'
import { useMyTeams } from '@/team/useTeams'
import { Loading } from '@/ui/Loading'
import { Logo } from '@/ui/Logo'

/**
 * Landing route for authenticated users: their first team's board.
 *
 * With no teams it used to go straight to team creation. That was wrong for
 * the person who was invited here: they would land on "name your team" when
 * the thing they actually needed was one click away in their invitations.
 */
export default function TeamsHome() {
  const { data: teams, isLoading } = useMyTeams()
  const invites = useMyInvitesAuthMeInvitesGet()

  if (isLoading || invites.isPending) {
    return (
      <div className="h-screen">
        <Loading />
      </div>
    )
  }

  if (teams && teams.length > 0) {
    return <Navigate to={`/${teams[0].key}`} replace />
  }

  if ((invites.data ?? []).length === 0) {
    return <Navigate to="/new-team" replace />
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="pop-in w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <Logo size={52} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            You've been <span className="text-gradient">invited</span>
          </h1>
          <p className="mt-1.5 text-sm text-neutral-500">
            Accept one to get started, or start a team of your own.
          </p>
        </div>

        <div className="glass-strong sheen rounded-panel p-5">
          <InvitesBanner />
          <Link to="/new-team" className="btn btn-secondary mt-4 h-10 w-full text-sm">
            Create a team instead
          </Link>
        </div>
      </div>
    </div>
  )
}

import { Navigate } from 'react-router-dom'

import { useAuthConfigAuthConfigGet } from '@/api/generated/endpoints/auth/auth'
import { useAuth } from '@/auth/AuthContext'
import { homeView } from '@/landing/homeView'
import LandingPage from '@/landing/LandingPage'
import TeamsHome from '@/team/TeamsHome'
import { Loading } from '@/ui/Loading'

/**
 * What `/` answers, which now depends on who is asking.
 *
 * Signed in it is `TeamsHome`, exactly as when this route lived inside
 * `RequireAuth`. Signed out it is the landing page -- or the sign-in form, on
 * an instance that set `LANDING_PAGE=false` because everyone opening it
 * already knows what SoftTrack is.
 *
 * Only `/` moved out of `RequireAuth`. Every other route is still behind it,
 * so a signed-out visitor opening /ENG/issue/42 is still sent to /login with
 * that location in hand, and still arrives there afterwards.
 *
 * The choice itself is in `homeView`; this renders it.
 */
export default function HomeRoute() {
  const { isAuthenticated, isLoading } = useAuth()
  const config = useAuthConfigAuthConfigGet()

  const view = homeView({
    isLoading,
    isAuthenticated,
    configPending: config.isPending,
    landingPage: config.data?.landing_page,
  })

  switch (view) {
    case 'loading':
      return (
        <div className="h-screen">
          <Loading />
        </div>
      )
    case 'teams':
      return <TeamsHome />
    case 'login':
      return <Navigate to="/login" replace />
    case 'landing':
      return <LandingPage />
  }
}

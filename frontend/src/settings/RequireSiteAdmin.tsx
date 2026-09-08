import { Navigate, Outlet } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Loading } from '@/ui/Loading'

/**
 * Keeps the admin console out of the nav *and* out of the URL bar for
 * everyone else. The API refuses regardless -- this only saves them a 403.
 */
export function RequireSiteAdmin() {
  const { user, isLoading } = useAuth()
  if (isLoading) return <Loading />
  if (!user?.is_site_admin) return <Navigate to="/settings/profile" replace />
  return <Outlet />
}

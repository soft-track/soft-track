import { createContext, useContext } from 'react'

import type { UserMe } from '@/api/generated/models'

/**
 * The session half of a context/provider pair split across two files.
 *
 * Split for Fast Refresh, not for taste: Vite can only hot-swap a module
 * whose exports are all components, so a file exporting `AuthProvider` and
 * `useAuth` together made every edit to either a full reload -- taking the
 * signed-in session's in-memory state with it. The provider stays in
 * `AuthContext.tsx`; everything a consumer needs is here.
 */
export interface AuthContextValue {
  user: UserMe | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  register: (
    email: string,
    password: string,
    fullName: string,
    options?: { username?: string; inviteToken?: string },
  ) => Promise<void>
  /**
   * Adopt a token the API just handed back.
   *
   * Changing a password or signing out everywhere invalidates every token
   * including the one in this tab, and the endpoints return a fresh one so the
   * person who just secured their account is not thrown out of it. Exposed
   * rather than private because the settings pages are where that happens.
   */
  setSession: (token: string, user: UserMe) => void
  /**
   * Start a session that may belong to somebody else.
   *
   * What signing in with Google or GitHub ends in. Distinct from `setSession`
   * because the cached queries are dropped first: the person arriving is not
   * necessarily the person who was signed in a moment ago, and a stale `me`
   * would otherwise show the wrong name until it refetched.
   */
  adoptSession: (token: string, user: UserMe) => void
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}

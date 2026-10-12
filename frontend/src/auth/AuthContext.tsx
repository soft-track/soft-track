import { useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Axios from 'axios'

import { AUTH_TOKEN_STORAGE_KEY, AXIOS_INSTANCE } from '@/api/client'
import {
  getMeAuthMeGetQueryKey,
  useLoginAuthLoginPost,
  useMeAuthMeGet,
  useRegisterAuthRegisterPost,
} from '@/api/generated/endpoints/auth/auth'
import type { UserMe } from '@/api/generated/models'
import { AuthContext, type AuthContextValue } from '@/auth/useAuth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(AUTH_TOKEN_STORAGE_KEY),
  )
  const queryClient = useQueryClient()

  const meQuery = useMeAuthMeGet({
    query: { enabled: Boolean(token), retry: false },
  })

  const loginMutation = useLoginAuthLoginPost()
  const registerMutation = useRegisterAuthRegisterPost()

  const setSession = (newToken: string, user: UserMe) => {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, newToken)
    setToken(newToken)
    queryClient.setQueryData(getMeAuthMeGetQueryKey(), user)
  }

  const adoptSession = (newToken: string, user: UserMe) => {
    queryClient.clear()
    setSession(newToken, user)
  }

  const login = async (email: string, password: string) => {
    const result = await loginMutation.mutateAsync({
      data: { username: email, password },
    })
    setSession(result.access_token, result.user)
  }

  const register = async (
    email: string,
    password: string,
    fullName: string,
    options?: { username?: string; inviteToken?: string },
  ) => {
    const result = await registerMutation.mutateAsync({
      data: {
        email,
        password,
        full_name: fullName,
        username: options?.username || undefined,
        invite_token: options?.inviteToken || undefined,
      },
    })
    setSession(result.access_token, result.user)
  }

  const logout = () => {
    // Ends this browser's session on the server too (#308), so it leaves the
    // list of sessions. Best effort, and deliberately not through the shared
    // client: an answer of 401 there would bounce the page to /login, and the
    // browser forgets the token whatever the server says.
    const current = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
    if (current) {
      Axios.post(`${AXIOS_INSTANCE.defaults.baseURL}/auth/sign-out`, null, {
        headers: { Authorization: `Bearer ${current}` },
      }).catch(() => {})
    }
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
    setToken(null)
    queryClient.clear()
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      user: meQuery.data ?? null,
      isLoading: Boolean(token) && meQuery.isPending,
      isAuthenticated: Boolean(token) && Boolean(meQuery.data),
      login,
      register,
      setSession,
      adoptSession,
      logout,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meQuery.data, meQuery.isPending, token],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}


import { useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { AUTH_TOKEN_STORAGE_KEY } from '@/api/client'
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


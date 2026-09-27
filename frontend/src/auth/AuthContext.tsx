import { useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { AUTH_TOKEN_STORAGE_KEY } from '@/api/client'
import {
  getMeAuthMeGetQueryKey,
  useLoginAuthLoginPost,
  useMeAuthMeGet,
  useRegisterAuthRegisterPost,
  useTotpVerifyAuthTotpVerifyPost,
} from '@/api/generated/endpoints/auth/auth'
import type { UserMe } from '@/api/generated/models'
import { AuthContext, isTotpPending, type AuthContextValue } from '@/auth/useAuth'

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
  const totpVerifyMutation = useTotpVerifyAuthTotpVerifyPost()

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
    // A 202: the password was right, and the account wants its code too.
    if (isTotpPending(result)) return result
    setSession(result.access_token, result.user)
    return null
  }

  const totpVerify = async (pendingToken: string, code: string) => {
    const result = await totpVerifyMutation.mutateAsync({
      data: { pending_token: pendingToken, code },
    })
    // Adopted rather than set: the first factor may have been Google or
    // GitHub, and whoever arrives is not necessarily who was here before.
    adoptSession(result.access_token, result.user)
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
      totpVerify,
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


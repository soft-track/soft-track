import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { AUTH_TOKEN_STORAGE_KEY } from '@/api/client'
import {
  getMeAuthMeGetQueryKey,
  useLoginAuthLoginPost,
  useMeAuthMeGet,
  useRegisterAuthRegisterPost,
} from '@/api/generated/endpoints/auth/auth'
import type { UserPublic } from '@/api/generated/models'

interface AuthContextValue {
  user: UserPublic | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, fullName: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

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

  const persistToken = (newToken: string, user: UserPublic) => {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, newToken)
    setToken(newToken)
    queryClient.setQueryData(getMeAuthMeGetQueryKey(), user)
  }

  const login = async (email: string, password: string) => {
    const result = await loginMutation.mutateAsync({
      data: { username: email, password },
    })
    persistToken(result.access_token, result.user)
  }

  const register = async (email: string, password: string, fullName: string) => {
    const result = await registerMutation.mutateAsync({
      data: { email, password, full_name: fullName },
    })
    persistToken(result.access_token, result.user)
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
      logout,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meQuery.data, meQuery.isPending, token],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}

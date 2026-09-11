import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { AUTH_TOKEN_STORAGE_KEY, AXIOS_INSTANCE } from '@/api/client'
import {
  getMeAuthMeGetQueryKey,
  useRegisterAuthRegisterPost,
  useMeAuthMeGet,
} from '@/api/generated/endpoints/auth/auth'
import type { UserMe } from '@/api/generated/models'

export interface TotpPending {
  pending_token: string
  totp_required: true
}

interface AuthContextValue {
  user: UserMe | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<TotpPending | null>
  totpVerify: (pendingToken: string, code: string) => Promise<void>
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

  const registerMutation = useRegisterAuthRegisterPost()

  const setSession = (newToken: string, user: UserMe) => {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, newToken)
    setToken(newToken)
    queryClient.setQueryData(getMeAuthMeGetQueryKey(), user)
  }

  const login = async (email: string, password: string): Promise<TotpPending | null> => {
    const form = new URLSearchParams()
    form.append('username', email)
    form.append('password', password)
    const response = await AXIOS_INSTANCE.post('/auth/login', form, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: (s) => s < 400,
    })

    if (response.status === 202) {
      return response.data as TotpPending
    }

    const { access_token, user } = response.data
    setSession(access_token, user)
    return null
  }

  const totpVerify = async (pendingToken: string, code: string): Promise<void> => {
    const response = await AXIOS_INSTANCE.post('/auth/totp/verify', {
      pending_token: pendingToken,
      code,
    })
    const { access_token, user } = response.data
    setSession(access_token, user)
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

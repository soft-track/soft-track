// @vitest-environment jsdom
/**
 * Signing out ends this browser's session on the server too (#308), so the
 * list of sessions does not go on showing it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render } from '@testing-library/react'
import Axios from 'axios'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AUTH_TOKEN_STORAGE_KEY } from '@/api/client'
import { AuthProvider } from '@/auth/AuthContext'
import { type AuthContextValue, useAuth } from '@/auth/useAuth'

vi.mock('@/api/generated/endpoints/auth/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/auth/auth')>()),
  useMeAuthMeGet: () => ({ data: undefined, isPending: false }),
}))

const seen: { auth: AuthContextValue | null } = { auth: null }

function Probe() {
  const value = useAuth()
  useEffect(() => {
    seen.auth = value
  })
  return null
}

function renderProvider() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  seen.auth = null
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Signing out', () => {
  it('tells the server with the token it is about to forget', () => {
    const post = vi.spyOn(Axios, 'post').mockResolvedValue({})
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'the-token')
    renderProvider()

    act(() => seen.auth!.logout())

    expect(post).toHaveBeenCalledTimes(1)
    const [url, body, config] = post.mock.calls[0]
    expect(url).toMatch(/\/auth\/sign-out$/)
    expect(body).toBeNull()
    expect(config?.headers).toEqual({ Authorization: 'Bearer the-token' })
    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('still signs out when the server cannot be told', () => {
    vi.spyOn(Axios, 'post').mockRejectedValue(new Error('offline'))
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'the-token')
    renderProvider()
    act(() => seen.auth!.logout())
    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('tells the server nothing without a token', () => {
    const post = vi.spyOn(Axios, 'post').mockResolvedValue({})
    renderProvider()
    act(() => seen.auth!.logout())
    expect(post).not.toHaveBeenCalled()
  })
})

/**
 * Renders the real LoginPage against a seeded /auth/config response.
 *
 * The bug worth a test is #67: the page printed the seeded demo account's
 * password under the sign-in button on every instance, not just the demo.
 * That is a working credential on the front page of a company's own tracker,
 * so "is it gone when the instance is not the demo" is the assertion.
 *
 * The suite runs in node with no DOM, so this renders to static markup and
 * primes the query cache instead of letting the request go out -- which also
 * means the assertions see the resolved config rather than the pending state
 * every unseeded render would show.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, describe, expect, it } from 'vitest'

import type { AuthConfig } from '@/api/generated/models'
import { getAuthConfigAuthConfigGetQueryKey } from '@/api/generated/endpoints/auth/auth'
import { AuthProvider } from '@/auth/AuthContext'
import LoginPage from '@/auth/LoginPage'

beforeAll(() => {
  // AuthProvider reads the stored token at mount, and there is no DOM here.
  const store = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size
    },
  } as Storage
})

const DEFAULT_CONFIG: AuthConfig = {
  open_registration: true,
  landing_page: true,
  demo_credentials: true,
}

function render(config: Partial<AuthConfig> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(getAuthConfigAuthConfigGetQueryKey(), {
    ...DEFAULT_CONFIG,
    ...config,
  })

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** The email input's `value`, so a match cannot come from the hint text. */
function emailValueIn(html: string): string {
  const field = /<input[^>]*id="login-email"[^>]*>/.exec(html)
  if (!field) throw new Error('no email field rendered')
  return /value="([^"]*)"/.exec(field[0])?.[1] ?? ''
}

describe('LoginPage', () => {
  it('offers the demo account where the demo account is seeded', () => {
    const html = render({ demo_credentials: true })
    expect(html).toContain('Demo login: demo@softtrack.dev / password123')
    expect(emailValueIn(html)).toBe('demo@softtrack.dev')
  })

  it('advertises no credentials on an instance that is not the demo', () => {
    const html = render({ demo_credentials: false })
    expect(html).not.toContain('Demo login')
    expect(html).not.toContain('password123')
    expect(html).not.toContain('demo@softtrack.dev')
  })

  it('leaves the email field empty there, so a password manager can fill it', () => {
    expect(emailValueIn(render({ demo_credentials: false }))).toBe('')
  })

  it('still hides the sign-up link on an invite-only instance', () => {
    expect(render({ open_registration: false })).not.toContain('Create one')
    expect(render({ open_registration: true })).toContain('Create one')
  })
})

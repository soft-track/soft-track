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
  oauth_providers: [],
  password_reset: false,
}

function render(config: Partial<AuthConfig> = {}, at = '/login') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(getAuthConfigAuthConfigGetQueryKey(), {
    ...DEFAULT_CONFIG,
    ...config,
  })

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[at]}>
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
  it('offers "Forgot password?" only where a reset email can be sent (#83)', () => {
    expect(render({ password_reset: true })).toContain('href="/forgot-password"')
    expect(render({ password_reset: false })).not.toContain('forgot-password')
  })

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

  it('offers no provider buttons on an instance that configured none', () => {
    // The default, and what keeps a self-hosted SoftTrack free of any
    // external dependency: no buttons, no divider, no missing feature.
    const html = render({ oauth_providers: [] })
    expect(html).not.toContain('Continue with')
    expect(html).not.toContain('>or<')
  })

  it('offers a button per configured provider', () => {
    const html = render({ oauth_providers: ['google', 'github'] })
    expect(html).toContain('Continue with Google')
    expect(html).toContain('Continue with GitHub')
  })

  it('renders them as buttons, not links', () => {
    // Pressing one has to write this tab's handshake into sessionStorage
    // first, and a sign-in opened in a second tab would not have it.
    const html = render({ oauth_providers: ['google'] })
    expect(html).not.toContain('/auth/oauth/google/start')
  })

  it('ignores a provider name this build does not know', () => {
    const html = render({ oauth_providers: ['gitlab'] })
    expect(html).not.toContain('gitlab')
    expect(html).not.toContain('>or<')
  })

  it('words a failed provider sign-in instead of showing its code', () => {
    const html = render({}, '/login?error=email_unverified')
    expect(html).toContain('has not verified that email address')
    expect(html).not.toContain('email_unverified')
  })
})

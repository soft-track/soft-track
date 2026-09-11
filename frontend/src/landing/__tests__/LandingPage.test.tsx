/**
 * The signed-out front door: the page itself, and what `/` decides to show.
 *
 * Rendered to static markup with the /auth/config response primed into the
 * query cache, so the assertions see resolved config rather than the pending
 * state an unseeded render would sit in. The suite has no DOM, so this covers
 * what the routes resolve to and what the page says -- not the theme toggle,
 * which needs a document to stamp.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeAll, describe, expect, it } from 'vitest'

import { getAuthConfigAuthConfigGetQueryKey } from '@/api/generated/endpoints/auth/auth'
import type { AuthConfig } from '@/api/generated/models'
import { AuthProvider } from '@/auth/AuthContext'
import HomeRoute from '@/landing/HomeRoute'

beforeAll(() => {
  // AuthProvider and useTheme both reach for storage at mount; there is no
  // DOM here. Empty means signed out, which is the case under test.
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
  demo_credentials: false,
}

/** Renders `/` through the real route, so what it resolves to is the result. */
function renderHome(config: Partial<AuthConfig> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(getAuthConfigAuthConfigGetQueryKey(), {
    ...DEFAULT_CONFIG,
    ...config,
  })

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<HomeRoute />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('the signed-out /', () => {
  it('is the landing page, not a redirect to the sign-in form', () => {
    const html = renderHome()
    expect(html).toContain('An issue tracker your team can')
    expect(html).toContain('Run it yourself')
    // The thing this replaced: / used to render nothing but a bounce to /login.
    expect(html).not.toContain('Sign in to')
  })

  it('renders no landing page on an instance that turned it off', () => {
    // What it redirects to instead is homeView's business, and is covered
    // there -- <Navigate> redirects from an effect, and this renderer runs
    // none.
    expect(renderHome({ landing_page: false })).not.toContain(
      'An issue tracker your team can',
    )
  })

  it('offers a way in either way', () => {
    expect(renderHome()).toContain('href="/login"')
  })
})

describe('LandingPage', () => {
  it('invites people to register on an open instance', () => {
    expect(renderHome({ open_registration: true })).toContain('href="/register"')
  })

  it('links to no sign-up form on an invite-only instance', () => {
    const html = renderHome({ open_registration: false })
    expect(html).not.toContain('href="/register"')
    expect(html).toContain('href="/login"')
  })

  it('advertises the demo account only where it is seeded', () => {
    expect(renderHome({ demo_credentials: true })).toContain('password123')
    expect(renderHome({ demo_credentials: false })).not.toContain('password123')
  })

  it('describes what the tracker is, since that is the point of the page', () => {
    const html = renderHome()
    for (const heading of ['A board and a list', 'Reports from real history']) {
      expect(html).toContain(heading)
    }
  })
})

/**
 * The pure half of signing in with a provider: the URL the browser leaves by,
 * what it is handed on the way back, and the wording of what went wrong.
 *
 * The suite runs in node with no DOM and `renderToStaticMarkup` never runs an
 * effect, so the parts that would otherwise live inside `OAuthCallbackPage`
 * are here as plain functions precisely so they can be tested at all.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  isProviderName,
  knownProviders,
  oauthErrorMessage,
  parseCallbackHash,
  startProviderFlow,
  startUrl,
  storedHandshake,
} from '@/auth/oauth'

const HANDSHAKE = 'a-handshake-this-tab-kept'

function ensureSessionStorage(): void {
  if (typeof globalThis.sessionStorage !== 'undefined') return

  const values = new Map<string, string>()
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    },
  } as Storage
}

describe('startUrl', () => {
  it('points at the API, not at the frontend', () => {
    // The browser leaves SoftTrack from here, and it is the *API* that has to
    // set the state cookie -- a URL on the app's own origin would skip it.
    expect(startUrl('google', { handshake: HANDSHAKE })).toBe(
      `http://localhost:8000/auth/oauth/google/start?hs=${HANDSHAKE}`,
    )
  })

  it('carries the destination, the invitation and a connect ticket', () => {
    const url = startUrl('github', {
      handshake: HANDSHAKE,
      next: '/ENG/issue/42',
      invite: 'tok en',
      ticket: 'link-ticket',
    })
    expect(url).toContain('next=%2FENG%2Fissue%2F42')
    expect(url).toContain('invite=tok+en')
    expect(url).toContain('ticket=link-ticket')
  })

})

describe('startProviderFlow', () => {
  // Node versions before 22 do not provide sessionStorage or window.
  const navigations: string[] = []

  beforeEach(() => {
    navigations.length = 0
    ensureSessionStorage()
    sessionStorage.clear()
    globalThis.window = {
      get location() {
        return {
          set href(value: string) {
            navigations.push(value)
          },
        }
      },
    } as unknown as Window & typeof globalThis
  })

  it('keeps the handshake in this tab and sends only the URL out', () => {
    startProviderFlow('google', { next: '/ENG' })

    const kept = storedHandshake()
    expect(kept).not.toBe('')
    expect(navigations).toHaveLength(1)
    expect(navigations[0]).toContain(`hs=${encodeURIComponent(kept)}`)
    expect(navigations[0]).toContain('next=%2FENG')
  })

  it('mints a fresh handshake each time, so an old ticket cannot be redeemed', () => {
    startProviderFlow('google')
    const first = storedHandshake()
    startProviderFlow('google')
    expect(storedHandshake()).not.toBe(first)
  })

  it('reports a browser that refuses to store, rather than leaving', () => {
    // Node's `sessionStorage` global is an accessor handing back a fresh
    // Storage each read, so spying on a method off it does not stick. Swap
    // the whole thing.
    const real = globalThis.sessionStorage
    globalThis.sessionStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('storage disabled')
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    } as Storage
    try {
      // A sign-in and a connect fail on different pages -- the same rule the
      // API follows for every other refusal in this flow.
      startProviderFlow('google')
      startProviderFlow('google', { ticket: 'link-ticket' })
    } finally {
      globalThis.sessionStorage = real
    }
    expect(navigations).toEqual([
      '/login?error=storage',
      '/settings/security?error=storage',
    ])
  })
})

describe('parseCallbackHash', () => {
  it('reads a finished sign-in', () => {
    expect(parseCallbackHash('#ticket=abc&next=%2FENG')).toEqual({
      kind: 'signin',
      ticket: 'abc',
      next: '/ENG',
    })
  })

  it('reads a finished connect, which is spent a different way', () => {
    // A sign-in ticket is redeemed with the handshake; a connect result is
    // posted with the session. Telling them apart is this function's job.
    expect(parseCallbackHash('#link=xyz&next=%2Fsettings%2Fsecurity')).toEqual({
      kind: 'link',
      ticket: 'xyz',
      next: '/settings/security',
    })
  })

  it('defaults the destination when the API sent none', () => {
    expect(parseCallbackHash('#ticket=abc')?.next).toBe('/')
  })

  it('answers null for a page somebody opened by hand', () => {
    expect(parseCallbackHash('')).toBeNull()
    expect(parseCallbackHash('#next=%2FENG')).toBeNull()
  })
})

describe('knownProviders', () => {
  it('keeps only names this build can render', () => {
    // /auth/config is data from a server that may be newer than this bundle.
    // An unrecognised name would become a label and a path segment.
    expect(knownProviders(['google', 'gitlab', 'github'])).toEqual([
      'google',
      'github',
    ])
  })

  it('treats a missing list as no providers', () => {
    expect(knownProviders(undefined)).toEqual([])
  })

  it('does not mistake an inherited property for a provider', () => {
    expect(isProviderName('constructor')).toBe(false)
    expect(isProviderName('toString')).toBe(false)
  })
})

describe('oauthErrorMessage', () => {
  it('says nothing when nothing went wrong', () => {
    expect(oauthErrorMessage(null)).toBeNull()
    expect(oauthErrorMessage('')).toBeNull()
  })

  it('words the codes the callback actually sends', () => {
    expect(oauthErrorMessage('cancelled')).toContain('cancelled')
    expect(oauthErrorMessage('email_unverified')).toContain('not verified')
    expect(oauthErrorMessage('closed')).toContain('invite-only')
  })

  it('words the two "an account already exists" cases differently', () => {
    // One of them has a password to sign in with. The other has a provider.
    // Telling the second to use a password it does not have is the whole
    // reason these are separate codes.
    expect(oauthErrorMessage('account_exists')).toContain('password')
    expect(oauthErrorMessage('connect_required')).not.toContain('password')
    expect(oauthErrorMessage('connect_required')).toContain('Settings')
  })

  it('tells somebody with an existing account what to do instead', () => {
    // The refusal that protects an account registered with a password from
    // being joined on the strength of an address alone. It is only acceptable
    // because this sentence names the way through.
    const message = oauthErrorMessage('account_exists')
    expect(message).toContain('password')
    expect(message).toContain('Settings')
  })

  it('never puts a crafted code on the page', () => {
    // `?error=` is whatever is in the address bar, and this is the only thing
    // standing between that and the sign-in form.
    expect(oauthErrorMessage('<img src=x onerror=alert(1)>')).toBe(
      'Could not finish signing in. Please try again.',
    )
  })
})

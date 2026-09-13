/**
 * Signing in with a provider, from the browser's side.
 *
 * There is no generated API client for the two endpoints in the middle of the
 * round trip, on purpose. Starting a sign-in is a *navigation*, not a request:
 * the browser has to leave SoftTrack, visit Google or GitHub, and come back
 * with a cookie the API set on the way out. An XHR would follow the redirect,
 * land on the provider's HTML, and be refused by CORS -- so this builds the
 * URL and `window.location` does the rest.
 *
 * The other half of this file is the handshake. Before leaving, a random value
 * is generated and kept in `sessionStorage`; only its digest travels, and the
 * API stores that in the state cookie. What comes back from the callback is a
 * two-minute *ticket*, which is worth nothing without the handshake still
 * sitting in this tab. That is what stops a link of the form
 * `/oauth/callback#ticket=...` mailed to somebody from signing them into the
 * sender's account.
 */

import { AXIOS_INSTANCE } from '@/api/client'

/**
 * The providers the backend knows how to talk to.
 *
 * A closed set here as well as there, so a name arriving from `/auth/config`
 * cannot put an unknown string into a URL or a label into the page.
 */
export const PROVIDERS = {
  google: 'Google',
  github: 'GitHub',
} as const

export type ProviderName = keyof typeof PROVIDERS

export function isProviderName(value: string): value is ProviderName {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, value)
}

/** Whichever of `/auth/config`'s providers this build can actually render. */
export function knownProviders(names: string[] | undefined): ProviderName[] {
  return (names ?? []).filter(isProviderName)
}

const HANDSHAKE_KEY = 'softtrack.oauth-handshake'

export interface StartOptions {
  /** Where to land afterwards. Validated again on the server. */
  next?: string
  /** The token from an invitation link, so accepting one can go through a provider. */
  invite?: string
  /** From `/auth/oauth/{provider}/link-ticket`: connect, rather than sign in. */
  ticket?: string
}

/** Where to send the browser to begin. Pure, so it can be read in a test. */
export function startUrl(
  provider: ProviderName,
  options: StartOptions & { handshake: string },
): string {
  const base = (AXIOS_INSTANCE.defaults.baseURL ?? '').replace(/\/+$/, '')
  const params = new URLSearchParams({ hs: options.handshake })
  if (options.next) params.set('next', options.next)
  if (options.invite) params.set('invite', options.invite)
  if (options.ticket) params.set('ticket', options.ticket)
  return `${base}/auth/oauth/${provider}/start?${params}`
}

/** Leave for the provider, remembering what this tab will need to come back. */
export function startProviderFlow(
  provider: ProviderName,
  options: StartOptions = {},
): void {
  const handshake = randomHandshake()
  try {
    sessionStorage.setItem(HANDSHAKE_KEY, handshake)
  } catch {
    // Storage switched off, or Safari in private mode. Leaving early is the
    // honest failure: the round trip would complete and then be unable to
    // redeem its ticket, which reads as the provider's fault rather than the
    // browser's. Reported where the button was, the same discriminator the
    // API uses -- a sign-in belongs on /login, a connect on Settings.
    window.location.href = options.ticket
      ? '/settings/security?error=storage'
      : '/login?error=storage'
    return
  }
  window.location.href = startUrl(provider, { ...options, handshake })
}

/**
 * The handshake this tab left with, if it is the tab that left.
 *
 * Deliberately not removed once read. The callback page mounts twice under
 * React's StrictMode, and a read that consumed the value would make the second
 * mount fail in development only -- the worst kind of bug to own. Leaving it
 * costs nothing: it is per-tab, overwritten by the next sign-in, and useless
 * without a live ticket that was minted against its digest.
 */
export function storedHandshake(): string {
  try {
    return sessionStorage.getItem(HANDSHAKE_KEY) ?? ''
  } catch {
    // Safari in private mode, and anything with storage switched off.
    return ''
  }
}

function randomHandshake(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  // base64url, so it survives a query string unescaped. `crypto.subtle` is
  // deliberately not used anywhere here: it is absent on insecure origins, and
  // a plain-HTTP install on a LAN is a supported way to run SoftTrack. The
  // digest is the server's job.
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * What the callback page was handed, or null if it was opened by hand.
 *
 * Two kinds, and they are spent differently. A `ticket` is a finished sign-in,
 * redeemed with the handshake this tab kept. A `link` is a finished connect,
 * posted with the session this tab already holds — the write was deliberately
 * *not* done by the callback, so that the ticket which opened the round trip
 * is not a credential anyone who reads a URL can use.
 */
export type CallbackResult =
  | { kind: 'signin'; ticket: string; next: string }
  | { kind: 'link'; ticket: string; next: string }

export function parseCallbackHash(hash: string): CallbackResult | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const next = params.get('next') ?? '/'

  const ticket = params.get('ticket')
  if (ticket) return { kind: 'signin', ticket, next }

  const link = params.get('link')
  if (link) return { kind: 'link', ticket: link, next }

  return null
}

/**
 * What an `?error=` code means, in words.
 *
 * The callback cannot render a page, so it redirects with a code. The
 * sentences live on this side, next to every other string somebody reads --
 * and looking the code up in a fixed table is also what stops a crafted
 * `?error=` putting arbitrary text on the sign-in form.
 */
const MESSAGES: Record<string, string> = {
  cancelled: 'Sign-in was cancelled.',
  state:
    'That sign-in expired or could not be verified. Check that cookies are ' +
    'enabled, then try again.',
  account_exists:
    'An account already exists for that email address. Sign in with your ' +
    'password, then connect the provider from Settings → Security.',
  email_unverified:
    'Your provider has not verified that email address, so it cannot be used ' +
    'to sign in here. Verify it with them and try again.',
  no_email:
    'Your provider did not share an email address. Add a verified one to that ' +
    'account, or sign in with a password.',
  closed:
    'This SoftTrack is invite-only, and there is no invitation waiting for ' +
    'that address.',
  deactivated: 'This account has been deactivated.',
  connect_required:
    'An account here already uses that email address, and it signs in a ' +
    'different way. Sign in the way it was set up, then connect this from ' +
    'Settings → Security.',
  throttled: 'Too many attempts from here. Wait a minute and try again.',
  unavailable: 'That sign-in provider is not enabled on this SoftTrack.',
  storage:
    'This browser is not letting SoftTrack store anything, which the sign-in ' +
    'needs. Check that cookies and site data are enabled, then try again.',
  already_connected:
    'That provider account already signs in to a different SoftTrack account.',
  link_expired: 'That request expired. Try connecting again.',
  exchange_failed: 'The provider refused the sign-in. Please try again.',
  profile_failed: 'The provider did not say who you are. Please try again.',
}

const FALLBACK = 'Could not finish signing in. Please try again.'

export function oauthErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null
  return MESSAGES[code] ?? FALLBACK
}

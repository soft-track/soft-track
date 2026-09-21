/**
 * Where signing in should land.
 *
 * Two sources, because there are two ways to reach /login. `RequireAuth`
 * sends people here with the location they asked for in router state; an
 * invitation link, and anything pasted into a fresh tab, arrives with
 * `?next=` and no navigation state at all. A signed-out visitor opening
 * /ENG/issue/42 has to end up on /ENG/issue/42, not on the front page.
 *
 * Only a same-site absolute path is honoured. `next` is whatever was in the
 * address bar, and pointing a sign-in redirect at another origin is a
 * standard phishing lever -- so "https://elsewhere.example" and the
 * protocol-relative "//elsewhere.example" are both refused in favour of the
 * fallback.
 */
export const SIGN_IN_FALLBACK = '/'

export function signInDestination(
  next: string | null | undefined,
  from?: { pathname?: string } | null,
): string {
  const candidate = next || from?.pathname || SIGN_IN_FALLBACK
  return isSameSitePath(candidate) ? candidate : SIGN_IN_FALLBACK
}

/**
 * A path on this site: one leading slash and no authority after it.
 *
 * `//host` is protocol-relative, and browsers normalise the backslash in
 * `/\host` to the same thing, so both are off-site however they look.
 */
function isSameSitePath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
}

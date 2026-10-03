import Axios from 'axios'

/**
 * Share links (#245): the page's address, and the client that opens it.
 *
 * The address is built from the origin the admin is looking at, as an
 * invitation's is: the one address the instance is surely reachable at.
 */
export function sharedUrl(token: string, origin: string = window.location.origin): string {
  return `${origin}/shared/${token}`
}

/** Copy text, reporting whether the browser allowed it. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * A client of its own for the shared page, with no session in it.
 *
 * The app's client sends whoever is signed in with every request, and on a
 * 401 signs them out and goes to /login. The shared page needs neither: it
 * is for somebody with no account, the link is the whole credential, and a
 * 401 here means "this link asks for a password", which the page asks for.
 */
export const SHARED_CLIENT = Axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000',
})

/** The password a link asks for, in the header the API reads it from. */
export function passwordHeader(password: string | null): Record<string, string> {
  return password ? { 'X-Share-Password': password } : {}
}

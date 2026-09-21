/**
 * What `/` should show, as a decision separate from rendering it.
 *
 * `/` is the one route that answers differently depending on who is asking,
 * and the answer depends on two async sources at once -- whether the session
 * is still resolving, and whether this instance has a landing page at all.
 * Pulling it out keeps those four states enumerable, and testable without a
 * DOM.
 */
export type HomeView = 'loading' | 'teams' | 'landing' | 'login'

export function homeView({
  isLoading,
  isAuthenticated,
  configPending,
  landingPage,
}: {
  isLoading: boolean
  isAuthenticated: boolean
  configPending: boolean
  /** From /auth/config; undefined if the request has not answered. */
  landingPage: boolean | undefined
}): HomeView {
  if (isLoading) return 'loading'

  // Signed in, / is TeamsHome exactly as it was inside RequireAuth. The
  // landing page switch is about the signed-out door and nothing else, so it
  // is not consulted here.
  if (isAuthenticated) return 'teams'

  // Waiting is deliberate. Rendering the landing page first would show a
  // marketing page, for one frame, to precisely the instances that turned it
  // off -- which is the friction the switch exists to remove.
  if (configPending) return 'loading'

  // A failed request leaves this undefined, and the landing page is the
  // better of the two to fall back on: it is static, whereas a sign-in form
  // is useless against an API that is not answering.
  return landingPage === false ? 'login' : 'landing'
}
